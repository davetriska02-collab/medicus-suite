// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Immunisation bridge — the vaccine-rule uplift with NO engine change.
//
// Today vaccineEventInWindow() infers "given/declined" by text-scanning the
// coded record (problems/observations) against rule.statusTerms — the engine's
// own note warns "vaccination given elsewhere may not appear". The Transactional
// feed gives us real Immunization resources (bundle.immunisations). This bridge
// projects each Immunization into an observation entry whose NAME the existing
// statusTerms already match, so the unmodified engine reads vaccine status from
// structured data instead of inferring it.
//
//   completed  -> name = "<vaccine>"            (matches statusTerms.given)
//   not-done   -> name = "<vaccine> declined"   (matches statusTerms.declined;
//                 vaccineEventInWindow checks declined BEFORE given, so this is safe)
//
// The proper long-term fix is the native patch (see PATCH-vaccine-immunisations.md);
// this bridge delivers the same behaviour with zero changes to rules-engine.js.

(function (global) {
  'use strict';

  function bridgeImmunisations(bundle) {
    const imms = (bundle && bundle.immunisations) || [];
    if (!imms.length) return bundle;
    const projected = imms
      .filter((im) => im && im.label)
      .map((im) => ({
        name: im.status === 'not-done' ? `${im.label} declined` : im.label,
        code: im.code || null,
        date: im.date || null,
        value: null,
        source: 'immunisation-bridge',
      }));
    return { ...bundle, observations: [...((bundle && bundle.observations) || []), ...projected] };
  }

  const api = { bridgeImmunisations };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SentinelImmunisationBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
