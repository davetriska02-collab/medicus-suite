// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Reception pathway utilities
//
// Single authoritative implementation of pathway validation, sanitisation and
// effective-set resolution, shared by:
//   - options/options.js          (pathway editor + enable toggles, classic script)
//   - shared/io/reception-io.js   (backup import validation)
//   - side-panel/modules/reception/reception.js (effective pathway set, via global)
//   - node tests                  (test-reception-pathway-utils.js)
//
// Dual-export pattern: same as engine/rules-engine.js / shared/rule-currency.js.

(function(global) {
  'use strict';

  const VALID_TYPES = ['yesno', 'text', 'choice', 'multi'];
  const VALID_ESCALATE = ['999', 'duty'];
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,49}$/i;

  function isStr(v) { return typeof v === 'string'; }
  function nonEmpty(v) { return isStr(v) && v.trim().length > 0; }

  // ---------------------------------------------------------------------------
  // validatePathway(p) → string[]   (empty array = valid)
  // Structural + content rules. Red flags are the safety-critical part: a
  // pathway with no red-flag screen must never reach the reception UI.
  // ---------------------------------------------------------------------------
  function validatePathway(p) {
    const errs = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['Pathway must be an object.'];
    if (!nonEmpty(p.id) || !ID_RE.test(p.id)) errs.push('id: required, letters/digits/hyphens, max 50 chars.');
    if (!nonEmpty(p.title)) errs.push('title: required.');
    else if (p.title.length > 80) errs.push('title: max 80 characters.');
    if (p.appliesTo != null && !isStr(p.appliesTo)) errs.push('appliesTo: must be text.');
    if (p.sources != null && (!Array.isArray(p.sources) || p.sources.some(s => !isStr(s)))) {
      errs.push('sources: must be a list of text entries.');
    }

    if (!Array.isArray(p.redFlags) || p.redFlags.length < 1) {
      errs.push('redFlags: at least one red-flag question is required.');
    } else {
      const seen = new Set();
      p.redFlags.forEach((rf, i) => {
        const tag = `redFlags[${i}]`;
        if (!rf || typeof rf !== 'object') { errs.push(`${tag}: must be an object.`); return; }
        if (!nonEmpty(rf.id) || !ID_RE.test(rf.id)) errs.push(`${tag}.id: required (letters/digits/hyphens).`);
        else if (seen.has(rf.id)) errs.push(`${tag}.id: duplicate "${rf.id}".`);
        else seen.add(rf.id);
        if (!nonEmpty(rf.ask) || rf.ask.trim().length < 10) errs.push(`${tag}.ask: required, at least 10 characters.`);
        if (VALID_ESCALATE.indexOf(rf.escalate) === -1) errs.push(`${tag}.escalate: must be "999" or "duty".`);
      });
    }

    if (!Array.isArray(p.questions) || p.questions.length < 1) {
      errs.push('questions: at least one history question is required.');
    } else {
      const seen = new Set();
      p.questions.forEach((q, i) => {
        const tag = `questions[${i}]`;
        if (!q || typeof q !== 'object') { errs.push(`${tag}: must be an object.`); return; }
        if (!nonEmpty(q.id) || !ID_RE.test(q.id)) errs.push(`${tag}.id: required (letters/digits/hyphens).`);
        else if (seen.has(q.id)) errs.push(`${tag}.id: duplicate "${q.id}".`);
        else seen.add(q.id);
        if (!nonEmpty(q.ask)) errs.push(`${tag}.ask: required.`);
        if (VALID_TYPES.indexOf(q.type) === -1) errs.push(`${tag}.type: must be one of ${VALID_TYPES.join('/')}.`);
        if ((q.type === 'choice' || q.type === 'multi') &&
            (!Array.isArray(q.options) || q.options.length < 2 || q.options.some(o => !nonEmpty(o)))) {
          errs.push(`${tag}.options: choice/multi need at least 2 non-empty options.`);
        }
        if (q.label != null && !isStr(q.label)) errs.push(`${tag}.label: must be text.`);
      });
    }

    if (p.pharmacyFirst != null) {
      const pf = p.pharmacyFirst;
      if (typeof pf !== 'object' || Array.isArray(pf)) errs.push('pharmacyFirst: must be an object.');
      else {
        if (!nonEmpty(pf.note)) errs.push('pharmacyFirst.note: required when pharmacyFirst is present.');
        if (pf.ageMin != null && typeof pf.ageMin !== 'number') errs.push('pharmacyFirst.ageMin: must be a number.');
        if (pf.ageMax != null && typeof pf.ageMax !== 'number') errs.push('pharmacyFirst.ageMax: must be a number.');
      }
    }
    return errs;
  }

  // ---------------------------------------------------------------------------
  // sanitisePathway(p) → clean copy
  // Whitelist-copies known fields only (trimmed) — imported/edited pathways
  // never carry unknown properties into storage or the renderer.
  // ---------------------------------------------------------------------------
  function sanitisePathway(p) {
    const t = v => isStr(v) ? v.trim() : v;
    const out = {
      id: t(p.id),
      title: t(p.title),
      appliesTo: nonEmpty(p.appliesTo) ? t(p.appliesTo) : undefined,
      sources: Array.isArray(p.sources) ? p.sources.filter(nonEmpty).map(t) : undefined,
      redFlags: (p.redFlags || []).map(rf => ({ id: t(rf.id), ask: t(rf.ask), escalate: rf.escalate })),
      questions: (p.questions || []).map(q => {
        const cq = { id: t(q.id), ask: t(q.ask), type: q.type };
        if (q.type === 'choice' || q.type === 'multi') cq.options = (q.options || []).filter(nonEmpty).map(t);
        if (nonEmpty(q.label)) cq.label = t(q.label);
        return cq;
      }),
    };
    if (p.pharmacyFirst && typeof p.pharmacyFirst === 'object') {
      out.pharmacyFirst = {
        note: t(p.pharmacyFirst.note),
        ageMin: typeof p.pharmacyFirst.ageMin === 'number' ? p.pharmacyFirst.ageMin : undefined,
        ageMax: typeof p.pharmacyFirst.ageMax === 'number' ? p.pharmacyFirst.ageMax : undefined,
      };
    }
    if (out.appliesTo === undefined) delete out.appliesTo;
    if (out.sources === undefined) delete out.sources;
    return out;
  }

  // ---------------------------------------------------------------------------
  // resolveEffectivePathways({ bundled, overrides, customPathways, enabledPathways,
  //                             disclaimerAccepted })
  //
  //   bundled             — pathways array from rules/reception-pathways.json
  //   overrides           — { [bundledId]: pathway } practice edits of bundled pathways
  //   customPathways      — array of practice-authored pathways
  //   enabledPathways     — { [id]: true } (anything else = disabled; DEFAULT IS OFF)
  //   disclaimerAccepted  — boolean; MUST be strictly true for any pathway to be
  //                         enabled. When absent or falsy the returned `enabled`
  //                         array is ALWAYS empty (fail-safe). The `all` listing
  //                         is unaffected so toggle controls still render correctly
  //                         before acceptance.
  //
  // Returns { all, enabled }:
  //   all     — [{ pathway, origin: 'bundled'|'edited'|'custom', enabled,
  //                invalid, overrideInvalid }]
  //             invalid         — the ACTIVE pathway is unusable (invalid or
  //                               id-clashing custom): excluded from `enabled`.
  //             overrideInvalid — a practice edit failed validation and was
  //                               ignored; the bundled original stays active
  //                               and enable-able. Flagged, never silent.
  //   enabled — pathway objects that are enabled AND usable AND disclaimer has
  //             been accepted, in listing order. Empty when disclaimer not accepted.
  // ---------------------------------------------------------------------------
  function resolveEffectivePathways(input) {
    const bundled = (input && input.bundled) || [];
    const overrides = (input && input.overrides) || {};
    const custom = (input && input.customPathways) || [];
    const enabledMap = (input && input.enabledPathways) || {};
    // Disclaimer gate: if not strictly true, no pathway is enabled (fail-safe).
    const disclaimerAccepted = (input && input.disclaimerAccepted) === true;
    const all = [];
    const seenIds = new Set();

    for (const b of bundled) {
      if (!b || !b.id || seenIds.has(b.id)) continue;
      seenIds.add(b.id);
      const ov = overrides[b.id];
      let pathway = b, origin = 'bundled', overrideInvalid = false;
      if (ov) {
        const errs = validatePathway(ov);
        if (errs.length === 0 && ov.id === b.id) { pathway = ov; origin = 'edited'; }
        else { overrideInvalid = true; } // ignore the bad edit; bundled original stays active
      }
      all.push({ pathway, origin, enabled: enabledMap[b.id] === true, invalid: false, overrideInvalid });
    }

    for (const c of custom) {
      if (!c || !c.id) continue;
      const clash = seenIds.has(c.id);
      const errs = validatePathway(c);
      if (clash || errs.length > 0) {
        all.push({ pathway: c, origin: 'custom', enabled: false, invalid: true, overrideInvalid: false });
        continue;
      }
      seenIds.add(c.id);
      all.push({ pathway: c, origin: 'custom', enabled: enabledMap[c.id] === true, invalid: false, overrideInvalid: false });
    }

    // Disclaimer gate: even if a pathway has enabled===true in the config, it
    // must not reach reception until a local admin has explicitly accepted the
    // disclaimer in-browser. When disclaimerAccepted is false, enabled is always
    // empty so the capture UI shows "pathways are switched off".
    const enabled = disclaimerAccepted
      ? all.filter(e => e.enabled && !e.invalid).map(e => e.pathway)
      : [];
    return { all, enabled };
  }

  const api = { validatePathway, sanitisePathway, resolveEffectivePathways };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ReceptionPathwayUtils = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global));
