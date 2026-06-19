// engine/outstanding-match.js — Outstanding investigation request matcher
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Implements Dr Grundy's algorithm for the "Outstanding Investigation Requests"
// card on a Review Investigation Report task. Medicus's native "Match all"
// button is blunt: it matches the report to EVERY outstanding request, clearing
// them all — so a coeliac screen / HFE gene / CCP antibody buried in the list is
// silently cleared even though this report says nothing about it.
//
// Instead we decide PER REQUEST:
//   - resulted     — this report satisfies it: the report covers the same
//                    test/panel AND the request was made on or before the
//                    sample-taken date ("find all requests for that test where
//                    the request predates the sample taken time/date").
//   - outstanding  — this report does NOT satisfy it (different test, or the
//                    request post-dates the sample). Stays unticked and is
//                    surfaced, so a genuinely-outstanding test isn't cleared.
//
// SAFETY (read this before touching the maps):
//   A false "resulted" auto-clears a genuinely-outstanding investigation — the
//   exact harm this feature exists to prevent. The matcher is therefore
//   HIGH-PRECISION and fail-safe: when a match is uncertain it returns
//   `outstanding` (chase, don't clear), and only CONFIDENT matches
//   (panel title / specimen-group match) are flagged auto-tick-eligible.
//   Tentative matches (distinctive-analyte membership only) are surfaced as
//   "resulted?" for the clinician but are NOT auto-ticked.
//
// This module is pure (no DOM, no network, no writes). The content-script
// adapter reads the card + report, calls matchOutstanding(), renders the
// advisory annotation, and auto-ticks only autoTick === true rows.

(function (global) {
  'use strict';

  // ── Name normalisation ───────────────────────────────────────────────────────
  // Lowercase; keep + and & (u&e, "creatinine + electrolyte"); everything else
  // becomes a single space. Whole-word/phrase matching is done against this form.
  function norm(s) {
    if (s == null) return '';
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9+&]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Whole-token phrase test: does `term` appear in `text` on word boundaries?
  // Avoids "alt" matching inside "salt" etc. `+`/`&` are treated as their own
  // tokens so "u&e" and "creatinine + electrolyte" match cleanly. A trailing-"s"
  // plural is tolerated (term "triglyceride" matches token "triglycerides",
  // "platelet" → "platelets") — analyte names appear in both singular and plural.
  function hasTerm(text, term) {
    const t = norm(term);
    if (!t) return false;
    const hay = ' ' + text + ' ';
    return hay.indexOf(' ' + t + ' ') !== -1 || hay.indexOf(' ' + t + 's ') !== -1;
  }

  // ── Card request-label parser ─────────────────────────────────────────────────
  // "Full Lipid Profile (Dr David Triska • 09 Jun 2026, 13:31)"
  //   → { name:'Full Lipid Profile', requester:'Dr David Triska', requestedDate:'2026-06-09' }
  // Splits on the LAST "(" so panel names that themselves contain parens
  // ("Prostate Specific Antigen (PSA)") keep their suffix.
  const MONTHS = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  function parseRequestLabel(text) {
    const raw = text == null ? '' : String(text).replace(/\s+/g, ' ').trim();
    const out = { name: null, requester: null, requestedDate: null, raw };
    if (!raw) return out;
    const open = raw.lastIndexOf('(');
    if (open > 0) {
      out.name = raw.slice(0, open).trim();
      const inner = raw.slice(open + 1).replace(/\)\s*$/, '');
      const bullet = inner.indexOf('•');
      out.requester = (bullet !== -1 ? inner.slice(0, bullet) : inner).trim() || null;
      const dm = inner.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
      if (dm) {
        const mon = MONTHS[dm[2].toLowerCase()];
        if (mon) out.requestedDate = `${dm[3]}-${mon}-${dm[1].padStart(2, '0')}`;
      }
    } else {
      out.name = raw;
    }
    return out;
  }

  // ── Canonical test/panel definitions ─────────────────────────────────────────
  // `req`      — phrases matched against the CARD request name (confirmed against
  //              real card data, capture 2026-06-19).
  // `rep`      — phrases matched against the REPORT panel title / specimen group
  //              name. A hit here is a CONFIDENT, auto-tick-eligible match.
  // `analytes` — DISTINCTIVE analyte names (each belongs to ONE panel). A hit
  //              here without a `rep` hit is a TENTATIVE match (surfaced, not
  //              auto-ticked). Shared analytes (ALP ∈ LFT & Bone; calcium ∈ Bone)
  //              are deliberately omitted so they can't establish a panel alone.
  //
  // VALIDATION STATUS: `rep`/`analytes` are seeded from standard UK panel
  // composition and MUST be confirmed against a parsed report (report-side
  // capture) before auto-tick ships on by default. Extend EXPECTED in
  // test-outstanding-match.js whenever this list changes.
  const TEST_DEFS = [
    {
      key: 'lipids',
      label: 'Lipid profile',
      req: ['lipid', 'cholesterol'],
      rep: ['lipid', 'lipid profile'],
      analytes: ['cholesterol', 'hdl', 'ldl', 'triglyceride', 'non hdl'],
    },
    {
      key: 'ue',
      label: 'U&E',
      req: ['electrolyte', 'u&e', 'urea electrolyte', 'creatinine + electrolyte'],
      rep: ['u&e', 'urea and electrolytes', 'electrolyte', 'renal profile'],
      analytes: ['sodium', 'potassium', 'urea', 'egfr', 'creatinine'],
    },
    {
      key: 'fbc',
      label: 'Full blood count',
      req: ['full blood count', 'fbc'],
      rep: ['fbc', 'full blood count'],
      analytes: ['haemoglobin', 'haematocrit', 'white cell count', 'platelet', 'neutrophil', 'mcv'],
    },
    {
      key: 'lft',
      label: 'Liver function test',
      req: ['liver function', 'lft'],
      rep: ['lft', 'liver function', 'liver function test'],
      analytes: ['alanine aminotransferase', 'alt', 'bilirubin', 'ggt', 'aspartate aminotransferase'],
    },
    {
      key: 'psa',
      label: 'PSA',
      req: ['prostate specific antigen', 'psa'],
      rep: ['psa', 'prostate specific antigen'],
      analytes: ['psa', 'prostate specific antigen'],
      singleAnalyte: true, // one PSA result IS the panel — 1 hit is confident
    },
    {
      key: 'tft',
      label: 'Thyroid function',
      req: ['thyroid', 'tft'],
      rep: ['tft', 'thyroid', 'thyroid function'],
      analytes: ['tsh', 'free t4', 'ft4', 'free t3', 'thyroid stimulating hormone'],
    },
    {
      key: 'fit',
      label: 'Faecal immunochemical test',
      req: ['faecal immunochemical', 'fit'],
      rep: ['fit', 'faecal immunochemical', 'faecal haemoglobin'],
      analytes: ['faecal haemoglobin', 'f hb'],
      singleAnalyte: true,
    },
    {
      key: 'ferritin',
      label: 'Ferritin',
      req: ['ferritin'],
      rep: ['ferritin'],
      analytes: ['ferritin'],
      singleAnalyte: true,
    },
    {
      key: 'bone',
      label: 'Bone profile',
      req: ['bone profile'],
      rep: ['bone profile'],
      analytes: ['phosphate', 'adjusted calcium', 'corrected calcium'],
    },
    {
      key: 'radiology_knee',
      label: 'Knee X-ray',
      // Radiology requests never match a pathology report — kept here so the
      // request resolves to a key (and so a future radiology report could match).
      req: ['xr knee', 'knee', 'radiograph knee'],
      rep: ['knee'],
      analytes: [],
    },
  ];

  // Resolve a free-text name to a canonical key via a set of term lists.
  // `fields` selects which term arrays to consult, in order. First def with any
  // matching term wins. Returns the def or null.
  function resolveDef(name, fields) {
    const text = norm(name);
    if (!text) return null;
    for (const def of TEST_DEFS) {
      for (const field of fields) {
        const terms = def[field];
        if (Array.isArray(terms) && terms.some((t) => hasTerm(text, t))) return def;
      }
    }
    return null;
  }

  // Day-granularity "request was made on or before the sample was taken".
  // Both are ISO "YYYY-MM-DD" (lexicographic compare is date-correct). A missing
  // date fails CLOSED (not predating) — we never auto-clear on unknown timing.
  function predatesOrSame(requestedDate, sampleDate) {
    if (!requestedDate || !sampleDate) return false;
    return String(requestedDate).slice(0, 10) <= String(sampleDate).slice(0, 10);
  }

  // ── Report coverage ───────────────────────────────────────────────────────────
  // From a normaliseInvestigationReport()-shaped report, derive the set of
  // canonical keys it covers, tagged by confidence:
  //   confident — auto-tick-eligible, reached EITHER by a panel title /
  //               specimen-group name matching `rep`, OR by a distinctive-analyte
  //               SIGNATURE (enough distinct `analytes` of one panel present that
  //               the report unambiguously IS that panel).
  //   tentative — a single distinctive analyte of a multi-analyte panel — could be
  //               an isolated test, so surfaced for the clinician, never auto-ticked.
  // The signature threshold is 1 for single-analyte tests (ferritin / PSA / FIT —
  // the lone result IS the panel) and 2 otherwise, so no stray shared analyte can
  // auto-clear a multi-analyte panel. Real Medicus reports may carry no specimen
  // group title at all (confirmed by capture), which is exactly why the analyte
  // signature exists — auto-tick must not depend on a title that isn't there.
  // Also returns the report's representative sample date (latest result date).
  function reportCoverage(report) {
    const confident = new Set();
    const tentative = new Set();
    let sampleDate = null;
    if (report && typeof report === 'object') {
      const results = Array.isArray(report.results) ? report.results : [];

      // (1) Panel title (if the adapter supplies one) + every specimen group name.
      const titles = [];
      if (report.title) titles.push(report.title);
      results.forEach((r) => {
        if (r && r.specimen) titles.push(r.specimen);
      });
      titles.forEach((tt) => {
        const def = resolveDef(tt, ['rep']);
        if (def) confident.add(def.key);
      });

      // (2) Distinctive-analyte signature: count DISTINCT analyte terms matched
      // per panel (so "Total cholesterol" + "HDL cholesterol" both matching
      // 'cholesterol' counts once — only genuinely different analytes accumulate).
      const termsByKey = new Map(); // canonical key → Set(matched analyte terms)
      results.forEach((r) => {
        if (!r || !r.name) return;
        const text = norm(r.name);
        TEST_DEFS.forEach((def) => {
          if (!Array.isArray(def.analytes)) return;
          def.analytes.forEach((term) => {
            if (hasTerm(text, term)) {
              if (!termsByKey.has(def.key)) termsByKey.set(def.key, new Set());
              termsByKey.get(def.key).add(norm(term));
            }
          });
        });
        if (r.date && (!sampleDate || String(r.date) > String(sampleDate))) sampleDate = r.date;
      });
      termsByKey.forEach((set, key) => {
        if (confident.has(key)) return;
        const def = TEST_DEFS.find((d) => d.key === key);
        const min = def && def.singleAnalyte ? 1 : 2;
        if (set.size >= min) confident.add(key);
        else tentative.add(key);
      });
    }
    return { confident, tentative, sampleDate };
  }

  // ── Enrich verdicts with patient history ─────────────────────────────────────
  // For requests still `outstanding` after matchOutstanding() — i.e. NOT covered
  // by the current report — check whether they appear in the patient's full
  // observation history (from normaliseObservationHistory). If found with a
  // result dated on/after the request date, the request is likely "resulted
  // elsewhere" (a previous episode, a different stack, a different report
  // never matched to this request).
  //
  // These are NEVER auto-ticked — they need clinician confirmation. The adapter
  // renders a "↩ elsewhere" badge + a manual "Tick off" button.
  //
  // Confidence uses the same analyte-signature rules as reportCoverage, PLUS a
  // group-name match (obs.group matching a panel's `rep`/`req` terms) which is
  // treated as confident (the laboratory assigned the group name; it is reliable).
  //
  // observationHistory: array of { name, group, unit, history: [{date, …}] }
  //   (normaliseObservationHistory output).
  function enrichWithHistory(verdicts, observationHistory) {
    if (!Array.isArray(observationHistory) || !observationHistory.length) return verdicts;
    return verdicts.map((v) => {
      if (v.status !== 'outstanding' || !v.key) return v;
      const def = TEST_DEFS.find((d) => d.key === v.key);
      if (!def) return v;

      let groupMatchDate = null; // most recent date from a group-name-matched obs
      const analyteTermDates = new Map(); // norm(term) → mostRecentDate

      observationHistory.forEach((obs) => {
        if (!obs) return;
        const nameText = norm(obs.name || '');
        const groupText = norm(obs.group || '');

        // Group-name match: obs.group matches any panel rep or req phrase.
        const groupHit =
          (groupText && def.rep.some((t) => hasTerm(groupText, t))) ||
          (groupText && def.req.some((t) => hasTerm(groupText, t)));
        // Analyte match: obs.name matches any distinctive analyte term.
        const analyteTerm = def.analytes.find((t) => hasTerm(nameText, t));

        if (!groupHit && !analyteTerm) return;

        // Collect history entries that are ON OR AFTER the request date.
        // If no request date, every entry qualifies (informational).
        const relevant = (obs.history || []).filter((h) => {
          if (!h || !h.date) return false;
          return !v.requestedDate || predatesOrSame(v.requestedDate, h.date);
        });
        if (!relevant.length) return;

        const latestDate = relevant.reduce((best, h) => (!best || String(h.date) > String(best) ? h.date : best), null);

        if (groupHit) {
          if (!groupMatchDate || String(latestDate) > String(groupMatchDate)) groupMatchDate = latestDate;
        }
        if (analyteTerm) {
          const nt = norm(analyteTerm);
          const prev = analyteTermDates.get(nt) || null;
          if (!prev || String(latestDate) > String(prev)) analyteTermDates.set(nt, latestDate);
        }
      });

      const hasGroupMatch = groupMatchDate !== null;
      const analyteCount = analyteTermDates.size;
      if (!hasGroupMatch && analyteCount === 0) return v; // nothing found

      const min = def.singleAnalyte ? 1 : 2;
      const confidentByAnalyte = analyteCount >= min;
      const confident = hasGroupMatch || confidentByAnalyte;

      // Most recent date across all matched signals.
      let elsewhereDate = groupMatchDate;
      analyteTermDates.forEach((d) => {
        if (!elsewhereDate || String(d) > String(elsewhereDate)) elsewhereDate = d;
      });

      return {
        ...v,
        status: 'resulted_elsewhere',
        confidence: confident ? 'confident' : 'tentative',
        elsewhereDate,
        autoTick: false,
        reason: confident
          ? `resulted elsewhere${elsewhereDate ? ` (most recent: ${elsewhereDate})` : ''}`
          : 'possibly resulted elsewhere — confirm before clearing',
      };
    });
  }

  // ── Main entry point ──────────────────────────────────────────────────────────
  // requests: array of { id?, name, requestedDate } (already parsed from the card,
  //           or raw label strings — strings are parsed via parseRequestLabel).
  // report:   normaliseInvestigationReport() shape (+ optional .title).
  // opts.sampleDate: override the report sample date (e.g. from the task header).
  //
  // Returns array aligned to `requests`, each:
  //   { id, name, requestedDate, key, status, confidence, autoTick, reason }
  //   status     — 'resulted' | 'outstanding'
  //   confidence — 'confident' | 'tentative' | null
  //   autoTick   — true only for confident + predating matches
  function matchOutstanding(requests, report, opts) {
    const options = opts || {};
    const cov = reportCoverage(report);
    const sampleDate = options.sampleDate || cov.sampleDate || null;
    const list = Array.isArray(requests) ? requests : [];

    return list.map((entry, i) => {
      const req =
        entry && typeof entry === 'object' && entry.name != null
          ? { name: entry.name, requestedDate: entry.requestedDate, id: entry.id }
          : parseRequestLabel(entry);
      const id = req.id != null ? req.id : i;
      const def = resolveDef(req.name, ['req']);
      const key = def ? def.key : null;

      const base = {
        id,
        name: req.name,
        requestedDate: req.requestedDate || null,
        key,
        status: 'outstanding',
        confidence: null,
        autoTick: false,
        reason: '',
      };

      if (!key) {
        base.reason = 'request test not recognised — left for manual review';
        return base;
      }
      const isConfident = cov.confident.has(key);
      const isTentative = cov.tentative.has(key);
      if (!isConfident && !isTentative) {
        base.reason = 'report does not cover this test';
        return base;
      }
      if (!predatesOrSame(base.requestedDate, sampleDate)) {
        base.reason = base.requestedDate
          ? 'request post-dates the sample — a later request, still outstanding'
          : 'request date unknown — not auto-cleared';
        return base;
      }
      // Covered + predating.
      base.status = 'resulted';
      base.confidence = isConfident ? 'confident' : 'tentative';
      base.autoTick = isConfident;
      base.reason = isConfident
        ? 'report covers this test and request predates the sample'
        : 'distinctive analyte matched — confirm before clearing';
      return base;
    });
  }

  // ── Module export (dual-mode: Node require OR browser global) ─────────────────
  const api = {
    matchOutstanding,
    enrichWithHistory,
    parseRequestLabel,
    reportCoverage,
    resolveDef,
    norm,
    TEST_DEFS,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelOutstandingMatch = api;
  }
})(typeof window !== 'undefined' ? window : global);
