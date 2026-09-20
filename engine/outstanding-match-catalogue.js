// Medicus Suite — Outstanding Requests matcher, Lab Result Catalogue engine (Phase D).
//
// PURE: no DOM, no chrome.*, no fetch. Same clearing rules as engine/outstanding-match.js (hazard H-036) — only the
// RECOGNITION step differs: a request is identified through the catalogue (SNOMED-coded, lab-scoped, membership-based)
// instead of free-text TEST_DEFS terms. It returns verdicts in the legacy shape so everything downstream (inline flags,
// auto-tick, audit, bulk bar, enrichWithHistory) is unchanged.
//
// Unchanged from the legacy engine, deliberately:
//   - a request only clears when the report covers it AND the request predates (or equals) the sample date;
//   - only a CONFIDENT match can auto-tick; tentative is flagged only;
//   - the 'strict' confidence floor: only a lab-scoped HEADING match is confident (signature-only is demoted).
// New (all additive fields on the verdict): investigationId, via ('heading'|'signature'), labMessageOnly,
// labMessageKind, engine:'catalogue'.
//
// Fail-safe contract: matchOutstandingCatalogue() never throws and never guesses. It returns
//   { ok: true,  verdicts }   — or —   { ok: false, error }
// and the caller falls back to the legacy engine on ok:false. A request the catalogue cannot identify unambiguously is
// left outstanding for manual review (a tie between two investigations is "unrecognised", never a pick).
//
// Run tests: node test-outstanding-match-catalogue.js

(function (global) {
  'use strict';

  const LC =
    typeof module !== 'undefined' && module.exports ? require('../shared/lab-catalogue-core.js') : global.LabCatalogue;

  function predatesOrSame(requestedDate, sampleDate) {
    if (!requestedDate || !sampleDate) return false;
    return String(requestedDate).slice(0, 10) <= String(sampleDate).slice(0, 10);
  }

  // Worst-first: the kind that most needs a human to notice.
  const KIND_ORDER = ['sample-problem', 'already-done', 'not-applicable', 'other'];
  const KIND_TEXT = {
    'sample-problem': 'lab reports a sample problem — may need repeating',
    'already-done': 'lab says it was already done recently',
    'not-applicable': 'lab says not applicable',
    other: 'lab message only, no value',
  };

  // The most concerning lab-message kind among the results that answered this investigation.
  function labMessageKindFor(res, id) {
    const kinds = new Set();
    for (const g of res.groups) {
      const answers = g.identifies.includes(id) || g.candidates.includes(id);
      if (!answers) continue;
      for (const r of g.results) {
        if (r.labMessage && (g.identifies.includes(id) || r.attributedTo.includes(id))) {
          kinds.add(r.labMessageKind || 'other');
        }
      }
    }
    return KIND_ORDER.find((k) => kinds.has(k)) || null;
  }

  function cleanName(entry, i) {
    if (entry && typeof entry === 'object' && entry.name != null) {
      return { id: entry.id != null ? entry.id : i, name: entry.name, requestedDate: entry.requestedDate || null };
    }
    const raw = entry == null ? '' : String(entry);
    return { id: i, name: LC.parseRequestName(raw), requestedDate: null };
  }

  // The acting catalogue's index, or null when there is nothing usable to match against.
  function buildActingIndex(catalogue) {
    if (!catalogue || typeof catalogue !== 'object') return null;
    const v = LC.validateCatalogue(catalogue);
    if (v.errors.length) return null;
    const index = LC.buildIndex(catalogue);
    return index && index.investigations && index.investigations.size > 0 ? index : null;
  }

  // requests: [{ id?, name, requestedDate }] (strings accepted, undated => never cleared)
  // report:   LabCatalogue.fromInvestigationReportPayload(raw) output
  // opts:     { index (from buildActingIndex, required), sampleDate (YYYY-MM-DD…, required to clear anything),
  //             confidenceFloor: 'default'|'strict', system: 'tquest'|'ice'|null }
  function matchOutstandingCatalogue(requests, report, opts) {
    try {
      const options = opts || {};
      const index = options.index;
      if (!index || !index.investigations || index.investigations.size === 0) {
        return { ok: false, error: 'no usable catalogue' };
      }
      if (!report || typeof report !== 'object') return { ok: false, error: 'no report' };
      const strict = options.confidenceFloor === 'strict';
      const sampleDate = options.sampleDate || null;
      const res = LC.resolveReport(index, report);
      const list = Array.isArray(requests) ? requests : [];

      const verdicts = list.map((entry, i) => {
        const req = cleanName(entry, i);
        const base = {
          id: req.id,
          name: req.name,
          requestedDate: req.requestedDate,
          key: null,
          status: 'outstanding',
          confidence: null,
          autoTick: false,
          reason: '',
          engine: 'catalogue',
        };

        const hits = LC.resolveRequest(index, req.name, options.system ? { system: options.system } : undefined);
        if (!hits.length) {
          base.reason = 'request test not in the catalogue — left for manual review';
          return base;
        }
        // Fail closed: two different investigations tying on specificity is ambiguous, not a pick.
        if (hits.length > 1 && hits[0].specificity === hits[1].specificity) {
          base.reason = 'request wording matches more than one catalogue test — left for manual review';
          return base;
        }
        const id = hits[0].investigationId;
        const inv = index.investigations.get(id);
        base.investigationId = id;
        base.key = inv && inv.def && inv.def.legacyKey ? inv.def.legacyKey : id;

        const cov = res.coverage[id];
        if (!cov) {
          base.reason = 'report does not cover this test';
          return base;
        }
        if (!predatesOrSame(base.requestedDate, sampleDate)) {
          base.reason = base.requestedDate
            ? 'request post-dates the sample — a later request, still outstanding'
            : 'request date unknown — not auto-cleared';
          return base;
        }
        let confident = cov.confidence === 'confident';
        // Evidence (a heading or result) shared by several result-less tests (generic "Ultrasonography") only says "an ultrasound was done".
        // If more than one of those tests is being asked for on this card it cannot say which — never confident.
        let sharedAmbiguous = false;
        if (confident && cov.sharedWith && cov.sharedWith.length) {
          const asked = new Set();
          for (const other of list) {
            const o = cleanName(other, 0);
            const h = LC.resolveRequest(index, o.name, options.system ? { system: options.system } : undefined);
            if (h.length && !(h.length > 1 && h[0].specificity === h[1].specificity)) asked.add(h[0].investigationId);
          }
          sharedAmbiguous = cov.sharedWith.some((x) => asked.has(x));
          if (sharedAmbiguous) confident = false;
        }
        if (strict && cov.via !== 'heading') confident = false;
        base.status = 'resulted';
        base.confidence = confident ? 'confident' : 'tentative';
        base.autoTick = confident;
        base.via = cov.via;
        base.labMessageOnly = !!cov.labMessageOnly;
        base.labMessageKind = cov.labMessageOnly ? labMessageKindFor(res, id) : null;
        const route = cov.via === 'heading' ? "the lab's heading" : 'the result names';
        base.sharedHeading = sharedAmbiguous;
        base.reason = confident
          ? `report covers this test (matched by ${route}) and request predates the sample`
          : sharedAmbiguous
            ? 'the lab report does not say which of the requested tests it answers — confirm before clearing'
            : 'distinctive analyte matched — confirm before clearing';
        if (base.labMessageOnly && base.labMessageKind) base.reason += ` — ${KIND_TEXT[base.labMessageKind]}`;
        return base;
      });
      return { ok: true, verdicts };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  const api = { matchOutstandingCatalogue, buildActingIndex, predatesOrSame, KIND_TEXT };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.OutstandingMatchCatalogue = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
