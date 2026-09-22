// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Result Catalogue: LEARN GAPS FROM REAL INVESTIGATION REPORTS (pure logic: no DOM, no chrome.*,
// no storage; the only I/O is the injected client used by collectObservations).
//
// PHASE C4 of docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md.
//
// The import from Outstanding Requests only knows the REQUEST form of a test. The lab's GROUP heading and the RESULT
// names / SNOMED codes exist only on the reports themselves. This module reads reports from the investigation-results
// queue and proposes the missing pieces, for the investigations the person selects:
//
//   * a report heading the lab really uses for the test (per lab),
//   * the results that heading carries (with their SNOMED codes and units),
//   * a code for a result the catalogue already knows by name only.
//
// Linking a group to a request is the hard part: a report does not say which request it answers, and the request list on
// the card is every OUTSTANDING request for the patient. So nothing is guessed:
//   * a group that the catalogue already recognises is left alone (except to fill missing codes on a known heading);
//   * an unrecognised group can only belong to a SELECTED test whose request is on that card;
//   * when the same heading is seen on several cards, the candidates are INTERSECTED across cards — one survivor is a
//     consistent link; more than one is AMBIGUOUS and the person must choose (a name-similarity hint is only a hint);
//   * nothing is auto-approved — the output is proposals; applying them writes unreviewed entries.
//
// PRIVACY: an observation keeps test names, headings, codes, units and the LAB'S OWN reference range ONLY — never
// this patient's result value, comments, dates, patient or staff fields. A reference range is the lab's own constant
// for the analyte/assay (the same for every patient), kept only to suggest a starting practice range in Lab Filing
// setup — never saved on its own. Callers must drop the raw payload immediately (collectObservations does).
//
// Dual-mode export: browser classic script -> window.LabCatalogueScan; Node/test -> require().

'use strict';

(function (global) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isStr = (v) => typeof v === 'string';
  const asArr = (v) => (Array.isArray(v) ? v : []);

  function core() {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        return require('./lab-catalogue-core.js');
      } catch (_) {
        /* fall through to the global */
      }
    }
    return global.LabCatalogue || null;
  }
  const need = () => {
    const LC = core();
    if (!LC) throw new Error('LabCatalogue core is not available in this context.');
    return LC;
  };

  const RESULTS_QUEUE_SLUG = 'review_investigation_results_task';
  const QUEUE_SEARCH = '?statuses[]=pending';

  // ── Observation (structure only) ──────────────────────────────────────────────────────────────────────────────
  function observationFromOverview(payload) {
    const LC = need();
    const rep = LC.fromInvestigationReportPayload(payload);
    const data = (payload && payload.data) || payload || {};
    const options = asArr(data.outstandingInvestigationRequestOptions);
    const keepResult = (r) => ({
      name: r.name,
      code: r.code,
      codeText: r.codeText,
      unit: r.unit,
      numeric: r.resultType === 'unit-value-result',
      degraded: !!r.degraded,
      refLow: r.refLow,
      refHigh: r.refHigh,
    });
    return {
      lab: { organisation: rep.lab.organisation, department: rep.lab.department },
      groups: rep.groups.map((g) => ({
        heading: g.heading,
        specimenType: g.specimenType,
        results: g.results.map(keepResult),
      })),
      ungrouped: rep.ungrouped.map(keepResult),
      requests: options.map((o) => (o && isStr(o.label) ? LC.parseRequestName(o.label) : '')).filter(Boolean),
    };
  }

  // ── Gaps ───────────────────────────────────────────────────────────────────────────────────────────────────────
  // What a test still lacks, judged against the labs the practice says it uses (all labs when it has not said).
  function findGaps(catalogue, context) {
    const labIds = asArr(context && context.labs);
    const labs = asArr(catalogue.labs).filter((l) => !labIds.length || labIds.includes(l.id));
    const resById = new Map(asArr(catalogue.results).map((r) => [r.id, r]));
    const out = [];
    for (const inv of asArr(catalogue.investigations)) {
      const members = asArr(inv.members);
      const noHeading = !labs.some((l) => asArr(l.groupHeadings).some((g) => asArr(g.identifies).includes(inv.id)));
      const noResults = members.length === 0 && ['blood', 'urine', 'faeces', 'microbiology'].includes(inv.kind);
      const noCodes = members.filter((m) => {
        const r = resById.get(m.result);
        return r && asArr(r.codes).length === 0;
      });
      if (!noHeading && !noResults && !noCodes.length) continue;
      out.push({
        id: inv.id,
        label: inv.label,
        kind: inv.kind,
        noHeading,
        noResults,
        resultsWithoutCode: noCodes.map((m) => m.result),
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  // ── Name similarity (a HINT for the person, never a decision) ───────────────────────────────────────────────────
  const STOP = new Set(['and', 'the', 'of', 'level', 'test', 'serum', 'plasma', 'blood', 'total', 'with', 'without']);
  function tokens(s) {
    const LC = need();
    return new Set(
      LC.norm(s)
        .split(' ')
        .filter((t) => t && !STOP.has(t))
        .map((t) => t.replace(/s$/, ''))
    );
  }
  function similarity(a, b) {
    const A = tokens(a);
    const B = tokens(b);
    if (!A.size || !B.size) return 0;
    let n = 0;
    for (const t of A) if (B.has(t)) n++;
    return n / Math.min(A.size, B.size);
  }

  // ── What sample / kind of test a group can belong to ───────────────────────────────────────────────────────────
  // A group from a radiology department can never be a blood test, and vice versa. Anything we cannot tell stays open.
  const IMAGING_RE =
    /(x ?ray|radiograph|ultrasound|ultrasonograph|sonograph|\bus\b|\bct\b|\bmri\b|dexa|imaging|radiolog|mammogra|fluoroscop|\bscan\b)/;
  function guessKindFromText(text) {
    const t = need().norm(text);
    if (IMAGING_RE.test(t)) return 'imaging';
    if (/(mc&s|mcs|swab|culture|sputum|mycology|microbiolog)/.test(t)) return 'microbiology';
    if (/(urine|urinary|msu)/.test(t)) return 'urine';
    if (/(faec|stool|calprotectin|elastase)/.test(t)) return 'faeces';
    return null; // could be anything
  }
  // Numeric results and nothing else to go on: any laboratory sample type (never imaging).
  const NUMERIC_ONLY = ['blood', 'urine', 'faeces', 'microbiology', 'other'];
  function compatibleKinds(group, lab) {
    const LC = need();
    const spec = LC.norm(group.specimenType || '');
    if (spec) {
      // A urine / faeces / blood specimen is also what a microbiology test (MC&S, culture, molecular screening) is run on,
      // so a microbiology test must stay a valid owner of such a group — otherwise "Urine culture" under a Urine MC&S
      // test is reported as unlinked even though it is already recorded.
      if (/(blood|serum|plasma)/.test(spec)) return ['blood', 'microbiology', 'other'];
      if (/urine/.test(spec)) return ['urine', 'microbiology', 'other'];
      if (/(faec|stool)/.test(spec)) return ['faeces', 'microbiology', 'other'];
      // ...and a microbiology specimen (swab, culture) may belong to a test recorded as urine / faeces / blood MC&S.
      if (/(swab|sputum|pus|fluid|tissue|culture|microbio)/.test(spec))
        return ['microbiology', 'urine', 'faeces', 'blood', 'other'];
    }
    const text = [group.heading, lab && lab.organisation, lab && lab.department].filter(Boolean).join(' ');
    if (IMAGING_RE.test(LC.norm(text))) return ['imaging', 'procedure', 'other'];
    if (asArr(group.results).some((r) => r.numeric)) return NUMERIC_ONLY;
    return null;
  }
  const kindOk = (kind, compat) => !compat || kind === 'other' || compat.includes(kind);
  // The kind a NEW test made from this group should have.
  function kindForGroup(agg) {
    const compat = compatibleKinds(
      { heading: agg.heading, specimenType: agg.specimen, results: [...agg.results.values()] },
      agg.labObs
    );
    if (!compat) return 'other';
    if (compat[0] === 'imaging') return 'imaging';
    if (compat === NUMERIC_ONLY) return 'blood'; // numeric results and nothing else to go on
    return compat[0] === 'other' ? 'other' : compat[0]; // a specimen was named
  }
  // The kind of a NEW test that has only a request (no results to recognise it by yet): imaging needs none; everything
  // else must have results, so it starts as "other" and takes its sample from the first report learned for it.
  const kindForRequest = (label) => (guessKindFromText(label) === 'imaging' ? 'imaging' : 'other');

  // Is this heading already recorded for THIS lab? (A lab-neutral alias such as "crp" recognises a group, but the gap the
  // person sees is the lab's own heading — so a group recognised only that way still yields a heading to add.)
  function labHeadingIds(lab, heading) {
    const LC = need();
    const h = LC.norm(heading);
    const out = new Set();
    if (!lab || !h) return [];
    for (const e of asArr(lab.headings)) {
      if (!LC.hasTerm(h, e.norm)) continue;
      const ids = e.identifies && e.identifies.forEach ? e.identifies : asArr(e.identifies);
      ids.forEach((id) => out.add(id));
    }
    return [...out];
  }

  // Why a group is not recognised, in words a person can act on: where (if anywhere) its heading is already recorded, and
  // whether the test it is recorded for is missing, or is the wrong sample type for this group's specimen.
  function whyUnexplained(index, invById, lab, obs, group, compat) {
    const LC = need();
    const h = LC.norm(group.heading);
    const notes = [];
    if (!lab)
      notes.push(
        'this lab (' +
          ((obs.lab && (obs.lab.department || obs.lab.organisation)) || 'unknown') +
          ') is not in the catalogue yet'
      );
    for (const l of index.labs) {
      for (const e of l.headings) {
        if (!LC.hasTerm(h, e.norm)) continue;
        const where = l.def.name || l.def.id;
        for (const id of e.identifies) {
          const iv = invById.get(id);
          if (!iv) notes.push('recorded under ' + where + ' for a test that no longer exists (' + id + ')');
          else if (!kindOk(iv.kind, compat))
            notes.push(
              'recorded under ' +
                where +
                ' for ' +
                iv.label +
                ', whose sample type (' +
                iv.kind +
                ") does not fit this group's specimen"
            );
          else if (l !== lab) notes.push('recorded for ' + iv.label + ' under a different lab entry (' + where + ')');
        }
      }
    }
    if (!notes.length)
      notes.push('its heading is not recorded against any test for this lab yet, and its results do not identify one');
    return [...new Set(notes)];
  }

  // ── Analysis ───────────────────────────────────────────────────────────────────────────────────────────────────
  // catalogue: the EFFECTIVE catalogue including unreviewed entries (what the person sees on the page)
  // observations: from observationFromOverview
  // opts.targets: investigation ids the person selected
  function analyse(catalogue, observations, opts) {
    const LC = need();
    const targets = new Set(asArr(opts && opts.targets));
    const index = LC.buildIndex(catalogue);
    const invById = new Map(asArr(catalogue.investigations).map((i) => [i.id, i]));
    const resById = new Map(asArr(catalogue.results).map((r) => [r.id, r]));
    const stats = {
      reports: 0,
      groups: 0,
      explained: 0,
      unexplained: 0,
      unknownRequests: new Map(),
      unmatchedHeadings: new Map(),
    };
    const groupsSeen = new Map(); // key -> aggregate

    for (const obs of asArr(observations)) {
      stats.reports++;
      const lab = LC.identifyLab(index, obs.lab);
      const labKey = lab
        ? lab.def.id
        : 'new:' + LC.norm(obs.lab && obs.lab.organisation) + '|' + LC.norm(obs.lab && obs.lab.department);
      const labInfo = lab
        ? { id: lab.def.id, name: lab.def.name, isNew: false }
        : {
            id: null,
            name: (obs.lab && (obs.lab.department || obs.lab.organisation)) || 'Unknown lab',
            org: obs.lab && obs.lab.organisation,
            dept: obs.lab && obs.lab.department,
            isNew: true,
          };
      const report = {
        lab: obs.lab,
        groups: obs.groups.map((g) => ({
          heading: g.heading,
          specimenType: g.specimenType,
          results: g.results.map((r) => ({
            name: r.name,
            code: r.code,
            codeText: r.codeText,
            unit: r.unit,
            resultType: r.numeric ? 'unit-value-result' : 'text-result',
            hasNumericValue: r.numeric,
            degraded: r.degraded,
          })),
        })),
        ungrouped: [],
      };
      const res = LC.resolveReport(index, report);

      // the card's requests -> selected tests present on it
      const onCard = new Set();
      const unknownOnCard = new Map(); // 'unknown:<norm>' -> label — requests the catalogue does not recognise
      for (const label of obs.requests) {
        const hits = LC.resolveRequest(index, label);
        if (!hits.length) {
          const k = LC.norm(label);
          if (k) {
            stats.unknownRequests.set(k, {
              label,
              kind: guessKindFromText(label),
              count: ((stats.unknownRequests.get(k) || {}).count || 0) + 1,
            });
            unknownOnCard.set('unknown:' + k, label);
          }
          continue;
        }
        const top = hits.filter((h) => h.specificity === hits[0].specificity);
        if (top.length === 1 && targets.has(top[0].investigationId)) onCard.add(top[0].investigationId);
      }

      obs.groups.forEach((g, gi) => {
        stats.groups++;
        const rg = res.groups[gi];
        const identifies = asArr(rg && rg.identifies);
        const allResolved = g.results.length > 0 && rg.results.every((r) => asArr(r.attributedTo).length);
        const compat = compatibleKinds(g, obs.lab);
        // Who the catalogue says owns this group — but only tests whose SAMPLE fits it. (A wrong link made earlier, e.g. an
        // ultrasound result attached to a blood test, must not make the group look "recognised" as that test.)
        const ownersRaw = identifies.length
          ? identifies
          : allResolved
            ? [...new Set(rg.results.flatMap((r) => asArr(r.attributedTo)))]
            : [];
        const owners = ownersRaw.filter((id) => {
          const iv = invById.get(id);
          return iv && kindOk(iv.kind, compat);
        });
        const explained = owners.length > 0;
        const why = explained ? [] : whyUnexplained(index, invById, lab, obs, g, compat);
        if (explained) stats.explained++;
        else stats.unexplained++;
        // explained groups matter only when they belong to a selected test (missing codes / results on a known heading)
        let owner = null;
        let ownerCands = [];
        if (explained) {
          const sel = owners.filter((id) => targets.has(id));
          if (!sel.length) return;
          // a generic imaging heading the lab records against several result-less tests on purpose (identifies) is finished:
          // there is nothing to choose between, and no results of their own to complete
          const noResults = (id) => ['imaging', 'procedure'].includes((invById.get(id) || {}).kind);
          if (sel.length > 1 && identifies.length && sel.every(noResults)) return;
          if (sel.length === 1) owner = sel[0];
          else ownerCands = sel; // its results belong to several selected tests: the person decides
        }
        const key = labKey + '|' + LC.norm(g.heading);
        if (!LC.norm(g.heading)) return;
        let agg = groupsSeen.get(key);
        if (!agg) {
          agg = {
            key,
            lab: labInfo,
            heading: g.heading,
            specimen: g.specimenType,
            headingIds: labHeadingIds(lab, g.heading),
            why,
            explained,
            owner,
            labObs: obs.lab,
            cards: [],
            unknownLabels: new Map(),
            results: new Map(),
            reports: 0,
            sole: 0,
          };
          groupsSeen.set(key, agg);
        }
        agg.reports++;
        if (explained && ownerCands.length) agg.cards.push(ownerCands);
        if (!explained) {
          // who could this group be? Only selected tests on the card whose sample fits the group — AND any request on
          // the card the catalogue does not recognise (the group may simply belong to that one).
          const real = [...onCard].filter((id) => kindOk(invById.get(id).kind, compat));
          const unk = [...unknownOnCard.keys()].filter((id) =>
            kindOk(guessKindFromText(unknownOnCard.get(id)) || 'other', compat)
          );
          unk.forEach((id) => agg.unknownLabels.set(id, unknownOnCard.get(id)));
          agg.cards.push([...real, ...unk]);
          if (real.length === 1 && !unk.length) agg.sole++;
        }
        g.results.forEach((r, ri) => {
          const rr = rg.results[ri];
          const rk = r.code ? 'c:' + r.code : 'n:' + LC.norm(r.name);
          const cur = agg.results.get(rk) || {
            name: r.name,
            code: r.code,
            codeText: r.codeText,
            unit: r.unit,
            numeric: r.numeric,
            count: 0,
            resultId: null,
            aliasOnly: false,
          };
          cur.count++;
          if (rr && rr.resultId) {
            cur.resultId = rr.resultId;
            const def = resById.get(rr.resultId);
            cur.aliasOnly = !!def && !asArr(def.codes).some((c) => c.conceptId === r.code) && !!r.code;
            cur.hasCodes = !!def && asArr(def.codes).length > 0;
          }
          if (!cur.unit && r.unit) cur.unit = r.unit;
          agg.results.set(rk, cur);
        });
      });
    }

    // ── proposals ──
    const proposals = [];
    const unmatched = [];
    let alreadyComplete = 0;
    for (const agg of groupsSeen.values()) {
      let candidates = [];
      let unknownCommon = [];
      let basis;
      const results = [...agg.results.values()]
        .map((r) => ({ ...r, freq: r.count / agg.reports }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      // Everything needed to turn an unlinked group into a new test (or attach it to another one) later.
      const orphan = (extra) => ({
        key: agg.key,
        lab: agg.lab,
        heading: agg.heading,
        headingIds: agg.headingIds,
        why: agg.why,
        headingKnown: false,
        specimen: agg.specimen || null,
        reports: agg.reports,
        kind: kindForGroup(agg),
        results,
        maybe: [],
        ...extra,
      });
      if (agg.owner) {
        candidates = [agg.owner];
        basis = 'recognised';
      } else {
        const informative = agg.cards.filter((c) => c.length);
        if (!informative.length) {
          unmatched.push(orphan({}));
          continue;
        }
        let inter = new Set(informative[0]);
        for (const c of informative.slice(1)) inter = new Set([...inter].filter((x) => c.includes(x)));
        // An imaging group ("Ultrasonography") is generic: each report of it usually answers a DIFFERENT request (groin,
        // abdomen, neck...). Intersecting the cards would keep only what they all share, so offer every test seen on any card.
        if (kindForGroup(agg) === 'imaging' && informative.length > 1) inter = new Set(informative.flat());
        const all = [...inter];
        candidates = all.filter((id) => !id.startsWith('unknown:'));
        const unk = all.filter((id) => id.startsWith('unknown:')).map((id) => agg.unknownLabels.get(id));
        if (!all.length) {
          unmatched.push(orphan({ conflict: true }));
          continue;
        }
        if (!candidates.length) {
          unmatched.push(orphan({ maybe: unk }));
          continue;
        }
        unknownCommon = unk;
        basis =
          candidates.length === 1 && !unk.length
            ? informative.length > 1
              ? 'consistent'
              : agg.sole
                ? 'sole'
                : 'consistent'
            : 'ambiguous';
      }
      // similarity hint per candidate
      const probe = [agg.heading, ...results.map((r) => r.name), ...results.map((r) => r.codeText || '')].filter(
        Boolean
      );
      const ranked = candidates
        .map((id) => {
          const inv = invById.get(id);
          const reqs = [inv.label, ...asArr(inv.requestAliases).map((a) => a.text)];
          let best = 0;
          for (const p of probe) for (const q of reqs) best = Math.max(best, similarity(p, q));
          return { id, score: best };
        })
        .sort((a, b) => b.score - a.score);
      const hint =
        ranked.length > 1 && ranked[0].score >= 0.5 && ranked[0].score > ranked[1].score ? ranked[0].id : null;
      const prop = {
        key: agg.key,
        lab: agg.lab,
        heading: agg.heading,
        headingIds: agg.headingIds,
        why: agg.why,
        headingKnown: candidates.length === 1 && agg.headingIds.includes(candidates[0]),
        specimen: agg.specimen || null,
        reports: agg.reports,
        basis, // recognised | sole | consistent | ambiguous
        kind: kindForGroup(agg),
        candidates: ranked.map((r) => r.id),
        target: candidates.length === 1 && !unknownCommon.length ? candidates[0] : null,
        // one generic group that several tests share: the person may link it to all of them (see coverage.sharedWith)
        multi: kindForGroup(agg) === 'imaging' && candidates.length > 1,
        unknownOnCard: unknownCommon,
        hint,
        results,
      };
      // a recognised group of a selected test that has nothing left to add is not worth showing
      if (prop.target && prop.headingKnown) {
        const f = fillsFromProposals(catalogue, [prop]).fills;
        if (!f.results.length && !f.members.length) {
          alreadyComplete++;
          continue;
        }
      }
      // A group the catalogue already recognises for SEVERAL selected tests (so the person is asked to choose) is finished
      // too when, whichever of them it is, there is nothing left to add: no heading, no result, no code.
      if (agg.explained && candidates.length > 1) {
        prop.recognisedFor = candidates.map((c) => {
          const f = fillsFromProposals(catalogue, [{ ...prop, target: c }]).fills;
          return {
            id: c,
            headings: f.labs.reduce((n, l) => n + l.headings.length, 0),
            results: f.results.length,
            members: f.members.length,
          };
        });
        const done = prop.recognisedFor.every((r) => !r.headings && !r.results && !r.members);
        if (done) {
          alreadyComplete++;
          continue;
        }
      }
      proposals.push(prop);
    }
    return {
      proposals: proposals.sort(
        (a, b) =>
          (invById.get(a.candidates[0]) || { label: '' }).label.localeCompare(
            (invById.get(b.candidates[0]) || { label: '' }).label
          ) || a.heading.localeCompare(b.heading)
      ),
      unmatched,
      unknownRequests: [...stats.unknownRequests.values()].sort((a, b) => b.count - a.count),
      stats: {
        alreadyComplete,
        reports: stats.reports,
        groups: stats.groups,
        explained: stats.explained,
        unexplained: stats.unexplained,
      },
    };
  }

  // ── Reference-range candidates (Lab Filing setup pre-fill) ────────────────────────────────────────────────────────
  // A SUGGESTION only, never a saved practice range: the lab's own reference range, seen on a recent report, for a
  // result the catalogue already has a CODE for, at a lab the catalogue already knows. One candidate per (lab, code) —
  // the most recently seen report wins (observations are read newest-first by the queue). A lab the catalogue does not
  // yet recognise, or a result with no code, yields no candidate: nothing to key it to.
  function referenceRangeCandidates(catalogue, observations) {
    const LC = need();
    const index = LC.buildIndex(catalogue);
    const out = new Map(); // 'labId|code' -> { lab, code, low, high, unit }
    for (const obs of asArr(observations)) {
      const lab = LC.identifyLab(index, obs.lab);
      if (!lab) continue; // an unrecognised lab has no stable id to key a candidate to
      for (const g of asArr(obs.groups)) {
        for (const r of asArr(g.results)) {
          if (!r.code || (r.refLow == null && r.refHigh == null)) continue;
          out.set(lab.def.id + '|' + r.code, { lab: lab.def.id, code: r.code, low: r.refLow, high: r.refHigh, unit: r.unit });
        }
      }
    }
    return [...out.values()];
  }

  // ── Proposal -> fills (for LabCatalogueOverlay.applyFills) ────────────────────────────────────────────────────────
  // choices: Map/obj proposal.key -> investigation id (for ambiguous ones). Returns { fills, skipped }.
  function fillsFromProposals(catalogue, proposals, choices) {
    const LC = need();
    const index = LC.buildIndex(catalogue);
    const invById = new Map(asArr(catalogue.investigations).map((i) => [i.id, i]));
    const resById = new Map(asArr(catalogue.results).map((r) => [r.id, r]));
    const pick = (k) => (choices instanceof Map ? choices.get(k) : choices && choices[k]);
    // a group linked to several tests at once (targets) is the same fill once per test
    proposals = asArr(proposals).flatMap((p) =>
      p && Array.isArray(p.targets) && p.targets.length
        ? p.targets.map((t) => ({ ...p, target: t, targets: null }))
        : [p]
    );
    const fills = { labs: [], results: [], members: [], newInvestigations: [], kinds: [] };
    const skipped = [];
    const newByKey = new Map();
    const resultFill = (id) => {
      let f = fills.results.find((x) => x.id === id);
      if (!f) {
        f = { id, codes: [], aliases: [], for: [] };
        fills.results.push(f);
      }
      return f;
    };
    for (const p of proposals) {
      let inv = null;
      if (p.newTest) {
        // a test that does not exist yet: made from a request wording and/or this group
        const nt = p.newTest;
        let f = fills.newInvestigations.find((x) => x.key === nt.key);
        if (!f) {
          f = { key: nt.key, label: nt.label, kind: nt.kind || 'other', requests: [] };
          fills.newInvestigations.push(f);
        }
        for (const r of asArr(nt.requests)) if (r && !f.requests.includes(r)) f.requests.push(r);
        inv = { id: 'new:' + nt.key, members: [], kind: f.kind };
      } else {
        const target = p.target || pick(p.key);
        inv = target ? invById.get(target) : null;
      }
      if (!inv) {
        skipped.push({ key: p.key, reason: 'no test chosen' });
        continue;
      }
      // the lab: an existing one, or a new one described by the report's performer
      let labRef = p.lab.id;
      if (p.lab.isNew) {
        labRef = 'new:' + LC.norm(p.lab.org) + '|' + LC.norm(p.lab.dept);
        if (!fills.labs.some((l) => l.ref === labRef))
          fills.labs.push({
            ref: labRef,
            newLab: { name: p.lab.name, org: p.lab.org, dept: p.lab.dept },
            headings: [],
          });
      } else if (!fills.labs.some((l) => l.ref === labRef)) fills.labs.push({ ref: labRef, headings: [] });
      const labFill = fills.labs.find((l) => l.ref === labRef);
      const known = Array.isArray(p.headingIds) ? p.headingIds.includes(inv.id) : !!p.headingKnown;
      if (!known) labFill.headings.push({ text: p.heading, identifies: [inv.id] });

      if (inv.kind === 'other' && p.kind && p.kind !== 'other' && !p.newTest)
        fills.kinds.push({ investigation: inv.id, kind: p.kind });
      const haveCore = asArr(inv.members).some((m) => m.role === 'core');
      const memberIds = new Set(asArr(inv.members).map((m) => m.result));
      const wanted = [];
      for (const r of p.results) {
        const byCode = r.code ? index.byCode.get(r.code) : null;
        let resultId = byCode ? byCode.resultId : r.resultId || null;
        // A result the resolver only matched by a word INSIDE its name ("Urine culture" contains the alias "culture") is a
        // different result, not this one: attaching its code and wording would merge unrelated tests' results (a urine
        // culture turning up inside a throat swab). Reuse a result found by name only when the name says the same thing ("Ferritin level" is ferritin; "Urine culture" is not "Culture").
        if (!byCode && resultId) {
          const d = resById.get(resultId);
          const mine = tokens(r.name);
          const own =
            d &&
            [d.label, ...asArr(d.aliases).map((a) => a.text)].some((t) => {
              const theirs = tokens(t);
              return theirs.size === mine.size && [...mine].every((x) => theirs.has(x));
            });
          if (!own) resultId = null;
        }
        if (resultId) {
          const def = resById.get(resultId);
          if (!resultFill(resultId).for.includes(inv.id)) resultFill(resultId).for.push(inv.id);
          if (!byCode && r.code)
            resultFill(resultId).codes.push({
              conceptId: r.code,
              ...(r.unit ? { unit: r.unit } : {}),
              ...(r.codeText ? { description: r.codeText } : {}),
            });
          const known =
            def && [def.label, ...asArr(def.aliases).map((a) => a.text)].some((t) => LC.norm(t) === LC.norm(r.name));
          if (!known) resultFill(resultId).aliases.push({ text: r.name, lab: labRef });
        } else {
          const nk = r.code ? 'c:' + r.code : 'n:' + LC.norm(r.name);
          if (!newByKey.has(nk)) {
            newByKey.set(nk, 'new:' + nk);
            fills.results.push({
              key: 'new:' + nk,
              for: [inv.id],
              label: r.name,
              valueKind: r.numeric ? 'numeric' : 'mixed',
              codes: r.code
                ? [
                    {
                      conceptId: r.code,
                      ...(r.unit ? { unit: r.unit } : {}),
                      ...(r.codeText ? { description: r.codeText } : {}),
                    },
                  ]
                : [],
              aliases: [{ text: r.name, lab: labRef }],
            });
          }
          resultId = newByKey.get(nk);
        }
        if (!memberIds.has(resultId)) {
          memberIds.add(resultId);
          wanted.push({ investigation: inv.id, result: resultId, freq: r.freq });
        }
      }
      // Roles: never add a second identifying (core) result to a test that already has one — that would change how many
      // results are needed to recognise it. A test with none gets its always-present results as core.
      wanted.forEach((m) => {
        m.role = haveCore ? 'optional' : m.freq >= 0.999 ? 'core' : 'optional';
      });
      if (!haveCore && wanted.length && !wanted.some((m) => m.role === 'core'))
        wanted.slice().sort((a, b) => b.freq - a.freq)[0].role = 'core';
      for (const m of wanted) fills.members.push({ investigation: m.investigation, result: m.result, role: m.role });
    }
    fills.results = fills.results.filter((f) => f.key || f.codes.length || f.aliases.length);
    fills.labs = fills.labs.filter(
      (l) => l.newLab || l.headings.length || fills.results.some((f) => f.aliases.some((a) => a.lab === l.ref))
    );
    return { fills, skipped };
  }

  // Request-only tests: the request wording exists on cards but not in the catalogue. They carry no results yet — a later
  // scan (with the new test selected) fills those in.
  function fillsForRequests(labels) {
    const LC = need();
    const fills = { labs: [], results: [], members: [], newInvestigations: [], kinds: [] };
    for (const label of asArr(labels)) {
      const text = String(label || '').trim();
      const key = 'req:' + LC.norm(text);
      if (!LC.norm(text) || fills.newInvestigations.some((x) => x.key === key)) continue;
      fills.newInvestigations.push({ key, label: text, kind: kindForRequest(text), requests: [text] });
    }
    return fills;
  }

  // An unlinked group + what the person decided -> a proposal fillsFromProposals understands.
  //   { type: 'test', id }      add it to an existing test
  //   { type: 'request', label } create a new test from an unrecognised request wording (and this group)
  //   { type: 'group' }         create a group-and-results test with no request wording yet
  function orphanToProposal(orphan, action) {
    const LC = need();
    if (!orphan || !action) return null;
    if (action.type === 'test' && action.id) return { ...orphan, target: action.id };
    if (action.type === 'tests' && asArr(action.ids).length) return { ...orphan, targets: asArr(action.ids) };
    if (action.type === 'request' && LC.norm(action.label)) {
      const label = String(action.label).trim();
      return {
        ...orphan,
        newTest: {
          key: 'req:' + LC.norm(label),
          label,
          kind: orphan.kind === 'other' ? kindForRequest(label) : orphan.kind,
          requests: [label],
        },
      };
    }
    if (action.type === 'group')
      return {
        ...orphan,
        newTest: { key: 'grp:' + orphan.key, label: orphan.heading, kind: orphan.kind, requests: [] },
      };
    return null;
  }

  function mergeFills(...list) {
    const out = { labs: [], results: [], members: [], newInvestigations: [], kinds: [] };
    for (const f of list) {
      if (!f) continue;
      for (const l of asArr(f.labs)) {
        const cur = out.labs.find((x) => x.ref === l.ref);
        if (cur) {
          cur.headings.push(...asArr(l.headings));
          if (l.newLab && !cur.newLab) cur.newLab = l.newLab;
        } else out.labs.push({ ...l, headings: [...asArr(l.headings)] });
      }
      for (const r of asArr(f.results)) {
        const cur = out.results.find((x) => (r.key ? x.key === r.key : x.id === r.id));
        if (cur) {
          cur.codes = [...asArr(cur.codes), ...asArr(r.codes)];
          cur.aliases = [...asArr(cur.aliases), ...asArr(r.aliases)];
          cur.for = [...new Set([...asArr(cur.for), ...asArr(r.for)])];
        } else out.results.push({ ...r });
      }
      out.members.push(...asArr(f.members));
      for (const n of asArr(f.newInvestigations)) {
        const cur = out.newInvestigations.find((x) => x.key === n.key);
        if (cur) cur.requests = [...new Set([...cur.requests, ...asArr(n.requests)])];
        else out.newInvestigations.push({ ...n, requests: [...asArr(n.requests)] });
      }
      out.kinds.push(...asArr(f.kinds));
    }
    return out;
  }

  // ── Reading the queue ──────────────────────────────────────────────────────────────────────────────────────────
  // client: LabAllocateCore.createClient(apiBase) (or a fake with the same two methods). Reads the pending results
  // queue, then each report's overview, keeping ONLY the structural observation. opts: { limit, concurrency, onProgress,
  // shouldStop }.
  async function collectObservations(client, opts) {
    const o = opts || {};
    const limit = Math.max(1, Math.min(500, o.limit || 100));
    const concurrency = Math.max(1, Math.min(6, o.concurrency || 3));
    const list = await client.fetchTaskList(RESULTS_QUEUE_SLUG, QUEUE_SEARCH);
    const urls = [];
    const seen = new Set();
    for (const row of asArr(list && list.rows)) {
      const u = row && row.overviewURL;
      if (isStr(u) && u && !seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }
    const total = Math.min(limit, urls.length);
    const work = urls.slice(0, total);
    const observations = [];
    let next = 0;
    let done = 0;
    let failed = 0;
    async function worker() {
      while (next < work.length) {
        if (o.shouldStop && o.shouldStop()) return;
        const u = work[next++];
        try {
          const payload = await client.fetchOverview(u);
          observations.push(observationFromOverview(payload));
        } catch (_) {
          failed++; // a report that cannot be read is skipped, never guessed
        }
        done++;
        if (o.onProgress) o.onProgress(done, total);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
    return { observations, total, failed, queueSize: urls.length };
  }

  const api = {
    RESULTS_QUEUE_SLUG,
    QUEUE_SEARCH,
    observationFromOverview,
    findGaps,
    analyse,
    referenceRangeCandidates,
    fillsFromProposals,
    fillsForRequests,
    orphanToProposal,
    mergeFills,
    collectObservations,
    similarity,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LabCatalogueScan = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
