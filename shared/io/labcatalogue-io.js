// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Result Catalogue IO helpers (backup, restore, practice-profile apply, effective-catalogue loader).
// PHASE B2/B3 of docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md.
//
// Storage: ONE key, 'labcatalogue.practice' — the practice OVERLAY (see shared/lab-catalogue-overlay.js): practice
// context (ICB / borough / labs / ordering systems), the practice's own results / investigations / lab definitions,
// retired ids and disables. The shipped baseline lives in rules/lab-catalogue.json and is never stored.
//
// Import safety (same doctrine as Lab Filing profiles, H-073): every entry that arrives by backup restore or by
// practice-profile sync is validated, whitelist-sanitised and FORCED INERT — provenance.reviewed:false — and is EXCLUDED
// from the effective catalogue until a person approves it on the machine that will act on it. Approvals never travel.
// An over-long or mistyped value REJECTS the import (nothing is written); prototype-pollution keys are dropped.
//
// NOT handled here: the "seen results" counts (docs §4.6) — a separate store with its own flush path (Phase B4).
// Nothing patient-identifying is ever held in this key.
//
// Loaded as a CLASSIC script in options.html and (via importScripts) the service worker — so everything is inside an IIFE
// and only the public functions are placed on the global, avoiding the "Identifier already declared" collision the other
// io files guard against. Node tests: require() and inject the baseline via opts.builtin.

'use strict';

(function (global) {
  const KEY = 'labcatalogue.practice';
  const BUILTIN_PATH = 'rules/lab-catalogue.json';

  function overlayApi() {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        return require('../lab-catalogue-overlay.js');
      } catch (_) {
        /* fall through to the global */
      }
    }
    return global.LabCatalogueOverlay || null;
  }
  function need() {
    const OV = overlayApi();
    if (!OV) throw new Error('Lab catalogue overlay helpers are not loaded in this context.');
    return OV;
  }

  let _builtinPromise = null;
  async function loadBuiltin(opts) {
    if (opts && opts.builtin) return opts.builtin;
    if (_builtinPromise) return _builtinPromise;
    _builtinPromise = (async () => {
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof fetch !== 'function') {
        throw new Error('The built-in lab catalogue cannot be loaded in this context.');
      }
      const res = await fetch(chrome.runtime.getURL(BUILTIN_PATH));
      if (!res.ok) throw new Error(`The built-in lab catalogue could not be read (${res.status}).`);
      return res.json();
    })().catch((e) => {
      _builtinPromise = null; // never cache a failure
      throw e;
    });
    return _builtinPromise;
  }

  // Descriptions and QOF status of the shipped SNOMED codes (rules/lab-code-info.json, built from the TRUD PCD files by
  // scripts/build-lab-code-info.js). Purely informational: a failure returns an empty table, never an error.
  let _infoPromise = null;
  async function labcatalogueLoadCodeInfo(opts) {
    if (opts && opts.info) return opts.info;
    if (_infoPromise) return _infoPromise;
    _infoPromise = (async () => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof fetch !== 'function')
          throw new Error('no runtime');
        const res = await fetch(chrome.runtime.getURL('rules/lab-code-info.json'));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (_) {
        _infoPromise = null; // never cache a failure
        return { qofClusters: [], codes: {} };
      }
    })();
    return _infoPromise;
  }

  async function readOverlay() {
    const OV = need();
    const r = await chrome.storage.local.get(KEY);
    return OV.sanitiseOverlay(r[KEY]);
  }

  // ── Backup ─────────────────────────────────────────────────────────────────────
  async function labcatalogueExport() {
    const OV = need();
    let practice;
    let warning = null;
    try {
      practice = await readOverlay();
    } catch (e) {
      // A corrupt stored value must never block a whole-suite backup: export an empty overlay and say why.
      practice = OV.emptyOverlay();
      warning = 'The stored lab catalogue overlay was unreadable and was not exported: ' + (e && e.message);
    }
    return warning ? { practice, warning } : { practice };
  }

  async function labcatalogueImport(data, opts) {
    const OV = need();
    if (!data || typeof data !== 'object') return { stored: false };
    if (data.practice === undefined) return { stored: false };
    const overlay = OV.forceInert(data.practice); // sanitises (throws on bad input) and forces inert
    const builtin = await loadBuiltin(opts);
    // Merge only to surface problems (an entry that cannot coexist with THIS build's baseline is excluded at merge time,
    // not fatal here — it is inert anyway and the settings page will list it).
    const m = OV.mergeCatalogue(builtin, overlay, { includeUnreviewed: true });
    await chrome.storage.local.set({ [KEY]: overlay });
    return { stored: true, problems: m.problems };
  }

  // ── Practice profile (published shared-folder profile) ────────────────────────────
  // merge   — local wins: only entries whose id is not already present locally are added (inert); the local reviewed state
  //           of anything already here is untouched; context fields fill blanks only; disables/retired are unioned (the
  //           fail-safe direction: a publish can only make the suite recognise LESS, never silently more).
  // replace — the published overlay is the practice's authoritative policy; everything (including entries a person had
  //           already approved locally) reverts to unreviewed for a fresh local review.
  async function labcatalogueApplyPublished(data, mode, opts) {
    const OV = need();
    if (!data || typeof data !== 'object' || data.practice === undefined) return { applied: false };
    const incoming = OV.forceInert(data.practice);
    const builtin = await loadBuiltin(opts);
    if (mode === 'replace') {
      const m = OV.mergeCatalogue(builtin, incoming, { includeUnreviewed: true });
      await chrome.storage.local.set({ [KEY]: incoming });
      return { applied: true, mode: 'replace', problems: m.problems };
    }
    const local = await readOverlay();
    const next = JSON.parse(JSON.stringify(local));
    const taken = {
      results: new Set(local.results.map((e) => e.id)),
      investigations: new Set(local.investigations.map((e) => e.id)),
      labs: new Set(local.labs.map((e) => e.id)),
    };
    for (const kind of ['results', 'investigations', 'labs']) {
      for (const e of incoming[kind]) {
        if (taken[kind].has(e.id)) continue; // local wins
        next[kind].push(e);
        taken[kind].add(e.id);
      }
    }
    const union = (a, b) => [...new Set([...a, ...b])];
    next.retired = union(local.retired, incoming.retired);
    next.disabled = {
      results: union(local.disabled.results, incoming.disabled.results),
      investigations: union(local.disabled.investigations, incoming.disabled.investigations),
    };
    const c = next.context;
    const ic = incoming.context;
    if (!c.icb) c.icb = ic.icb;
    if (!c.icbCode) c.icbCode = ic.icbCode;
    if (!c.borough) c.borough = ic.borough;
    c.labs = union(c.labs, ic.labs);
    c.orderingSystems = union(c.orderingSystems, ic.orderingSystems);
    const changed = JSON.stringify(next) !== JSON.stringify(local);
    if (!changed) return { applied: false, mode: 'merge' };
    OV.mergeCatalogue(builtin, next, { includeUnreviewed: true }); // throws only if the BASELINE is invalid
    await chrome.storage.local.set({ [KEY]: next });
    return { applied: true, mode: 'merge' };
  }

  // ── Local edit (settings page) ───────────────────────────────────────────────────────────────────────────────────
  // The settings page works on the overlay directly (pure ops in shared/lab-catalogue-overlay.js) and saves it here.
  // Unlike import/apply this does NOT force entries inert — approvals made on THIS machine are the point — but the value
  // is still whitelist-sanitised, and it must merge onto this build's baseline before it is stored.
  async function labcatalogueSaveOverlay(overlay, opts) {
    const OV = need();
    const clean = OV.sanitiseOverlay(overlay);
    const builtin = await loadBuiltin(opts);
    OV.mergeCatalogue(builtin, clean, { includeUnreviewed: true }); // throws only if the BASELINE is invalid
    await chrome.storage.local.set({ [KEY]: clean });
    return { stored: true };
  }

  // Current stored overlay, sanitised (settings page). Throws on a corrupt store so the page can say so.
  async function labcatalogueReadOverlay() {
    return readOverlay();
  }

  // ── Loader for consumers / the settings page ────────────────────────────────────
  // opts.includeUnreviewed:true is for the settings page ONLY; every acting consumer uses the default (reviewed only).
  async function labcatalogueLoadEffective(opts) {
    const OV = need();
    const [overlay, builtin] = await Promise.all([readOverlay(), loadBuiltin(opts)]);
    const m = OV.mergeCatalogue(builtin, overlay, { includeUnreviewed: !!(opts && opts.includeUnreviewed) });
    return {
      catalogue: m.catalogue,
      builtin,
      problems: m.problems,
      excluded: m.excluded,
      overlay,
      context: overlay.context,
    };
  }

  const api = {
    labcatalogueExport,
    labcatalogueImport,
    labcatalogueApplyPublished,
    labcatalogueLoadEffective,
    labcatalogueSaveOverlay,
    labcatalogueReadOverlay,
    labcatalogueLoadCodeInfo,
    LABCATALOGUE_KEYS: [KEY],
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(global, api);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : global);
