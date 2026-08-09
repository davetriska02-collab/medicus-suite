// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Cleanup Code Preferences: automatic practice-pool contribution.
//
// Distinct from PUBLISHING (options.js doPublish's "Publish to shared folder"
// flow, which curates and overwrites every module an admin has opted into). A
// CONTRIBUTOR only ever:
//   - writes THIS machine's own pdc tallies, merged against what's currently
//     shared (tallies via max(), never overwritten — see
//     problemDescriptionCleanupMergeForPublish);
//   - carries every other module, apply.modules and practiceAttestation
//     forward VERBATIM;
//   - never writes suite.practiceProfile.publisher, so it can never turn a
//     machine into a full publisher of anything else;
//   - requires the shared profile to already list problemDescriptionCleanup
//     in apply.modules — a contributor can add DATA, never decide to publish
//     a module nobody chose to publish;
//   - no-ops (records the attempt, writes nothing) when the merge produces no
//     change, so a quiet machine doesn't bump profileVersion for nothing;
//   - re-reads the shared file immediately before writing and aborts if it
//     moved since the last fetch (cheap optimistic-concurrency guard against
//     clobbering a write that landed in between).
//
// Runs from any page context that already holds (or can silently re-verify)
// a granted FileSystemFileHandle — options.js and the side panel both call
// runPdcContribution() on init. Never the service worker: obtaining or
// re-confirming write access needs a DOM/page context, and requestPermission()
// needs a user gesture this path must never attempt (a lapsed grant surfaces
// as a "Reconnect" affordance in the UI, not a prompt from a background cycle).
//
// Pure orchestration below: every IO operation is injected via `deps` so this
// runs identically from options.js, the side panel, or a Node test.

'use strict';

// IIFE, not top-level declarations: this loads as a classic <script> in
// options.html and panel.html, where top-level const/let land in the ONE
// global lexical environment shared by every classic script on the page —
// fs-handle-store.js (loaded just before this) and suite-envelope.js each
// declare their own top-level `const api`, so a bare `const api` here throws
// "Identifier 'api' has already been declared" and this whole file silently
// fails to run (window.PdcContribute never set, the feature dead).
(function () {
  const PDC_CONTRIBUTE_STATE_KEY = 'suite.pdcContribute';

  function _todayStr(now) {
    return (now || new Date()).toISOString().slice(0, 10);
  }

  function _parseVersion(v) {
    const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(v || ''));
    if (!m) return null;
    return { date: m[1], seq: parseInt(m[2], 10) };
  }

  // Same 'YYYY-MM-DD.N' scheme as options.js's nextProfileVersion, reimplemented
  // here (rather than imported) so this file has no load-order dependency on
  // options.js — it must also work standalone in the side panel.
  function nextProfileVersion(sharedProfile, todayISO) {
    const parsed = _parseVersion(sharedProfile && sharedProfile.profileVersion);
    if (parsed && parsed.date === todayISO) return `${todayISO}.${parsed.seq + 1}`;
    return `${todayISO}.1`;
  }

  function shouldContributeToday(state, todayISO) {
    return !(state && state.lastContributedAt === todayISO);
  }

  // Deep-equal via stable (key-sorted) JSON stringify — used only to detect a
  // genuine no-op, so a machine that learned nothing new today doesn't still
  // bump profileVersion and rewrite the shared file for no reason.
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

  // Confirms `text` really is a Medicus Suite practice profile before a handle
  // to it is ever stored — a contributor amends an existing profile, it must
  // never be pointed at an unrelated JSON file. When `fetchedProfile` is given
  // (the copy this install already reads via chrome.runtime.getURL), also
  // rejects a file whose modules share nothing with it — the best available
  // signal, absent a stronger identity marker in the format, that the picked
  // file belongs to a different practice/profile lineage rather than just
  // being a slightly older or newer version of the same one.
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

  // Strips every override (and its set/cleared markers) from a pdc export
  // before it ever reaches mergePdc. Belt-and-braces: mergePdc's own
  // includeOverride:false only protects an override the SHARED side already
  // has — when the shared side has none yet, it adopts whichever side offers
  // one, regardless of includeOverride. A contribution must never be able to
  // seed (or change) the practice-wide enforced choice under any
  // circumstance, so this removes the possibility at the source rather than
  // relying on that conditional. Tallies are untouched — contributing them is
  // the entire point.
  function _stripOverrides(pdcExport) {
    const strip = (field) => {
      const out = {};
      Object.keys(field || {}).forEach((key) => {
        const entry = field[key] || {};
        out[key] = { tally: entry.tally || {}, override: null };
      });
      return out;
    };
    return {
      preferredDescriptions: strip(pdcExport && pdcExport.preferredDescriptions),
      conceptRemap: strip(pdcExport && pdcExport.conceptRemap),
    };
  }

  // Builds the write payload: this machine's pdc tallies merged against the
  // shared copy, everything else carried forward verbatim. Mirrors doPublish's
  // former unattended-refresh branch (options.js), plus a `changed` check so
  // callers can skip writing when nothing moved, and the override-stripping
  // above (belt-and-braces beyond includeOverride:false — see _stripOverrides).
  //
  // deps.mergePdc must be problemDescriptionCleanupMergeForPublish.
  function buildPdcContribution(sharedProfile, localPdcExport, { version, now, mergePdc }) {
    const sharedEnvelope = sharedProfile && sharedProfile.envelope;
    const sharedModules = sharedEnvelope && sharedEnvelope.modules;
    const sharedApplyModules =
      sharedProfile && sharedProfile.apply && sharedProfile.apply.modules && !Array.isArray(sharedProfile.apply.modules)
        ? sharedProfile.apply.modules
        : null;

    if (!sharedEnvelope || !sharedModules) {
      return { skipReason: 'no-shared-profile' };
    }
    if (!sharedApplyModules || !sharedApplyModules.problemDescriptionCleanup) {
      // Nobody has chosen to publish this module — contributing to it would be
      // this machine deciding to publish something nobody opted into.
      return { skipReason: 'not-published' };
    }

    const existingPdc = sharedModules.problemDescriptionCleanup;
    const mergedPdc = mergePdc(existingPdc, _stripOverrides(localPdcExport), { includeOverride: false });

    if (_stableStringify(mergedPdc) === _stableStringify(existingPdc || {})) {
      return { skipReason: 'no-change' };
    }

    const carriedModules = Object.assign({}, sharedModules, { problemDescriptionCleanup: mergedPdc });
    const json = Object.assign({}, sharedProfile, {
      profileVersion: version,
      publishedAt: (now || new Date()).toISOString(),
      envelope: Object.assign({}, sharedEnvelope, { modules: carriedModules }),
    });
    return { json, changed: true };
  }

  // One-time migration for machines that were unattended daily publishers
  // before the contributor existed. Retiring maybeAutoPublish()/
  // doPublish({auto:true}) without this would silently stop those machines'
  // daily pdc tally circulation on upgrade: the replacement is gated on
  // suite.pdcContribute.enabled, which nothing set by default, so an
  // established publisher PC would quietly go dark until a human found the
  // new Options toggle. The gate here is EXACTLY the one the retired
  // maybeAutoPublish used (an established publish config: any saved
  // publisher module checked) — so this only ever continues an
  // already-established habit, never turns a random PC into a contributor.
  // An explicit enabled true/false already stored (the admin touched the
  // toggle) always wins and is never overwritten.
  async function migrateLegacyAutoPublisher(deps) {
    const state = await deps.getState();
    if (state && typeof state.enabled === 'boolean') return { migrated: false, reason: 'explicit-choice-exists' };
    const saved = await deps.getPublisherState();
    const hasEstablishedConfig = Object.values((saved && saved.modules) || {}).some((m) => m && m.checked);
    if (!hasEstablishedConfig) return { migrated: false, reason: 'no-publisher-config' };
    await deps.setState({ enabled: true, enabledVia: 'auto-publish-migration' });
    return { migrated: true };
  }

  // Orchestrates one full contribution cycle. Silent and fire-and-forget by
  // contract — every caller must treat every returned `reason` as routine, not
  // as an error to surface; a quiet retry next cycle is always correct. The
  // one exception a UI may want to react to is 'permission-not-granted' (offer
  // a "Reconnect" affordance) — everything else is expected, ordinary no-op.
  //
  // deps:
  //   getState()                  -> { enabled, lastContributedAt, lastResult } | null
  //   setState(patch)              -> merge patch into stored state
  //   getPublisherState()          -> stored suite.practiceProfile.publisher | null
  //                                    (optional — when present, machines with an
  //                                    established publish config and no explicit
  //                                    contribute choice are migrated to
  //                                    enabled:true; see migrateLegacyAutoPublisher)
  //   loadHandle()                 -> FileSystemFileHandle | null (already
  //                                    resolved to whichever handle this
  //                                    machine should use)
  //   readHandleText(handle)       -> current file contents as a string
  //   writeHandleText(handle, str) -> write + close
  //   fetchProfile()               -> this install's own read of the shared
  //                                    profile (chrome.runtime.getURL fetch),
  //                                    used only as a staleness cross-check
  //   getLocalPdc()                -> problemDescriptionCleanupExport() result
  //   mergePdc                     -> problemDescriptionCleanupMergeForPublish
  //   now()                        -> Date, injectable for tests
  async function runPdcContribution(deps) {
    const now = deps.now ? deps.now() : new Date();
    const todayISO = _todayStr(now);

    let state = await deps.getState();
    if ((!state || typeof state.enabled !== 'boolean') && deps.getPublisherState) {
      const migration = await migrateLegacyAutoPublisher(deps);
      if (migration.migrated) state = await deps.getState();
    }
    if (!state || state.enabled !== true) return { ran: false, reason: 'not-enabled' };
    if (!shouldContributeToday(state, todayISO)) return { ran: false, reason: 'already-today' };

    const handle = await deps.loadHandle();
    if (!handle) return { ran: false, reason: 'no-handle' };

    let perm;
    try {
      perm = await handle.queryPermission({ mode: 'readwrite' });
    } catch (e) {
      return { ran: false, reason: 'permission-check-failed', error: e && e.message };
    }
    // Never requestPermission() here — it needs a user gesture, and this path
    // must stay silent. A lapsed grant is left for the UI's own "Reconnect"
    // check (same queryPermission call, made from a click handler instead).
    if (perm !== 'granted') return { ran: false, reason: 'permission-not-granted' };

    let fileText;
    try {
      fileText = await deps.readHandleText(handle);
    } catch (e) {
      return { ran: false, reason: 'read-failed', error: e && e.message };
    }

    const verify = verifyProfileFile(fileText);
    if (!verify.ok) return { ran: false, reason: 'verify-failed', detail: verify.reason };
    const sharedProfile = verify.profile;

    // Optimistic-concurrency guard: if this install's own independent read of
    // the profile (via chrome.runtime.getURL) disagrees with what's on disk,
    // another write landed between us picking the handle and reading it —
    // abort rather than build a contribution against a copy that's already stale.
    const fetched = await deps.fetchProfile();
    if (fetched && fetched.profileVersion !== sharedProfile.profileVersion) {
      return { ran: false, reason: 'stale-read' };
    }

    const localPdc = await deps.getLocalPdc();
    const version = nextProfileVersion(sharedProfile, todayISO);
    const result = buildPdcContribution(sharedProfile, localPdc, { version, now, mergePdc: deps.mergePdc });

    if (result.skipReason) {
      // Still record today's attempt so a machine with nothing new to say
      // doesn't re-check every panel open for the rest of the day.
      await deps.setState({ lastContributedAt: todayISO, lastResult: result.skipReason });
      return { ran: true, wrote: false, reason: result.skipReason };
    }

    try {
      await deps.writeHandleText(handle, JSON.stringify(result.json, null, 2));
    } catch (e) {
      return { ran: true, wrote: false, reason: 'write-failed', error: e && e.message };
    }

    await deps.setState({ lastContributedAt: todayISO, lastResult: 'contributed' });
    return { ran: true, wrote: true };
  }

  const api = {
    PDC_CONTRIBUTE_STATE_KEY,
    nextProfileVersion,
    shouldContributeToday,
    verifyProfileFile,
    buildPdcContribution,
    migrateLegacyAutoPublisher,
    runPdcContribution,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof self !== 'undefined') {
    self.PdcContribute = api;
  }
})();
