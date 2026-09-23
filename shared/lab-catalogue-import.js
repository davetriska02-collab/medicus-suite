// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Result Catalogue: IMPORT from the practice's existing Outstanding-Investigation tests
// (pure logic: no DOM, no chrome.*, no fetch, no storage).
//
// PHASE C1 of docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md (§7 "Seeding from the practice's existing rules").
//
// Turns the triage config's `oirTests` ({ key, label, req[], rep[], analytes[], singleAnalyte, disabled }) into
// UNREVIEWED catalogue overlay entries plus a REVIEW LIST. It never applies anything itself and never guesses across a
// clinical boundary:
//   * An entry whose key is a built-in test's legacyKey EXTENDS that built-in (same id, append-only — the overlay
//     merge already refuses to change or remove anything of the built-in's).
//   * Entries that are clearly the same test as each other (same request term, same label, or a shared multi-word
//     heading/result name) are MERGED into one investigation; every merge is listed. Two entries that belong to two
//     DIFFERENT built-ins are never joined.
//   * A request that merely also resembles a built-in ("Hepatitis B antibody" vs the surface-antigen test) is NOT
//     merged — it stays a separate practice investigation and is flagged for a person to look at.
//   * The comma-split editor artefact ("RAST mixed foods (egg", "milk", … "peanut)") is repaired by re-joining
//     fragments until the brackets balance.
//   * Everything produced is provenance {source:'imported', reviewed:false}: inert until a person approves it.
//
// Role mapping (mirrors what the old matcher did, so coverage does not silently shrink or grow):
//   singleAnalyte:true  -> every analyte is a core+anchor result (any ONE of them clears the request)
//   singleAnalyte:false -> every analyte is a core result (two distinct ones needed, as before)
//   extending a SINGLE-result built-in -> an unknown analyte name becomes an ALIAS of that result (adding a second
//     core result would silently raise its threshold from 1 to 2); extending a MULTI-result built-in -> a new
//     OPTIONAL member (never lowers or raises what the built-in already recognises), flagged for review.
//
// Dual-mode export: browser classic script -> window.LabCatalogueImport; Node/test -> require().

'use strict';

(function (global) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const asArr = (v) => (Array.isArray(v) ? v : []);
  const isStr = (v) => typeof v === 'string';

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
  function overlayApi() {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        return require('./lab-catalogue-overlay.js');
      } catch (_) {
        /* fall through to the global */
      }
    }
    return global.LabCatalogueOverlay || null;
  }

  const slug = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '');

  // "RAST mixed foods (egg", "milk", "cod", "wheat", "soya", "peanut)"  ->  "RAST mixed foods (egg, milk, cod, wheat, soya, peanut)"
  function repairFragments(list) {
    const out = [];
    let repaired = false;
    let acc = null;
    const open = (s) => (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    for (const raw of asArr(list)) {
      const t = isStr(raw) ? raw.trim() : '';
      if (!t) continue;
      if (acc !== null) {
        acc += ', ' + t;
        repaired = true;
        if (open(acc) <= 0) {
          out.push(acc);
          acc = null;
        }
      } else if (open(t) > 0) {
        acc = t;
      } else {
        out.push(t);
      }
    }
    if (acc !== null) out.push(acc); // never lose an unbalanced tail
    return { list: out, repaired };
  }

  function guessKind(label, req) {
    const text = [label, ...req].join(' ').toLowerCase();
    if (/x-?ray|radiograph|ultrasound|\bus\b|\bct\b|\bmri\b|\bdexa\b|mammogra/.test(text)) return 'imaging';
    if (/\bmc&s\b|\bmcs\b|swab|culture|sputum|mycology|microbiolog/.test(text)) return 'microbiology';
    if (/urine|urinary|\bmsu\b/.test(text)) return 'urine';
    if (/faec|stool|calprotectin|elastase|\bfit\b/.test(text)) return 'faeces';
    return 'blood';
  }

  // opts: { labId?, today?, by? } ; builtin = the shipped catalogue object
  function importOirTests(oirTests, builtin, opts) {
    const LC = core();
    const OV = overlayApi();
    if (!LC || !OV) throw new Error('Lab catalogue core/overlay helpers are not loaded in this context.');
    const norm = LC.norm;
    const o = opts || {};
    const labId = isStr(o.labId) && o.labId ? o.labId : undefined;
    const today = o.today || new Date().toISOString().slice(0, 10);
    const review = [];
    const note = (type, message, extra) => review.push({ type, message, ...(extra || {}) });

    const base = builtin || { results: [], investigations: [], labs: [] };
    const baseInv = new Map(asArr(base.investigations).map((i) => [i.id, i]));
    const baseByLegacy = new Map(
      asArr(base.investigations)
        .filter((i) => i.legacyKey)
        .map((i) => [i.legacyKey, i])
    );
    const stripSpecimen = (t) =>
      norm(t)
        .split(' ')
        .filter((w) => w && !['blood', 'serum', 'plasma'].includes(w))
        .join(' ');
    const byExactReq = new Map(); // stripped wording -> built-in id (null when two built-ins share it)
    for (const i of asArr(base.investigations)) {
      for (const t of [i.label, ...asArr(i.requestAliases).map((a) => a && a.text), ...asArr(i.synonyms)]) {
        const k = stripSpecimen(t);
        if (!k) continue;
        byExactReq.set(k, byExactReq.has(k) && byExactReq.get(k) !== i.id ? null : i.id);
      }
    }
    const baseResults = new Map(asArr(base.results).map((r) => [r.id, r]));
    // normalised name -> builtin result id (label + every alias; first wins, later duplicates ignored)
    const baseResultByName = new Map();
    for (const r of asArr(base.results)) {
      for (const t of [r.label, ...asArr(r.aliases).map((a) => a && a.text)]) {
        const n = norm(t);
        if (n && !baseResultByName.has(n)) baseResultByName.set(n, r.id);
      }
    }

    const provenance = () => ({ source: 'imported', reviewed: false, createdAt: today, importedFrom: 'oirTests' });

    // ── 1. normalise ────────────────────────────────────────────────────────────────
    const entries = [];
    const disabledInv = [];
    asArr(oirTests).forEach((t, idx) => {
      if (!isObj(t) || !isStr(t.key) || !t.key) return note('skipped', `Entry #${idx + 1} has no key and was skipped.`);
      const req = repairFragments(t.req);
      const rep = repairFragments(t.rep);
      const analytes = repairFragments(t.analytes);
      if (req.repaired)
        note(
          'repaired',
          `"${t.label || t.key}": the request list had been split at commas inside brackets; re-joined.`,
          {
            key: t.key,
          }
        );
      const stem = t.key.replace(/-\d+$/, '');
      let legacy = baseByLegacy.get(t.key) || baseByLegacy.get(stem) || null;
      if (!legacy) {
        // Exact wording of a built-in's own request name (ignoring only the specimen words blood/serum/plasma) is the
        // same test by definition, e.g. "Magnesium blood" == the built-in "Magnesium". Anything looser is NOT merged.
        const hits = new Set(req.list.map((r) => byExactReq.get(stripSpecimen(r))).filter((x) => x !== undefined));
        if (hits.size === 1 && !hits.has(null)) legacy = baseInv.get([...hits][0]);
      }
      if (t.disabled === true) {
        if (legacy) disabledInv.push(legacy.id);
        else
          note(
            'skipped',
            `"${t.label || t.key}" is a disabled entry that matches no built-in test; nothing imported.`,
            { key: t.key }
          );
        return;
      }
      if (!req.list.length && !rep.list.length && !analytes.list.length) {
        return note('skipped', `"${t.label || t.key}" has no request, heading or result terms; nothing imported.`, {
          key: t.key,
        });
      }
      entries.push({
        key: t.key,
        label: (isStr(t.label) && t.label.trim()) || t.key,
        req: req.list,
        rep: rep.list,
        analytes: analytes.list,
        single: t.singleAnalyte === true,
        builtinId: legacy ? legacy.id : null,
      });
    });

    // ── 2. bucket (union-find; never join two different built-ins) ─────────────────────────────────
    const parent = entries.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const bucketBuiltin = new Map(); // root -> builtin id | null
    entries.forEach((e, i) => bucketBuiltin.set(i, e.builtinId));
    const why = new Map(); // root -> Set of reasons

    function tryUnion(i, j, reason) {
      const a = find(i);
      const b = find(j);
      if (a === b) return;
      const ba = bucketBuiltin.get(a);
      const bb = bucketBuiltin.get(b);
      if (ba && bb && ba !== bb) {
        note(
          'not-merged',
          `"${entries[i].label}" and "${entries[j].label}" look alike (${reason}) but belong to different built-in tests (${ba} / ${bb}); kept separate.`
        );
        return;
      }
      parent[b] = a;
      bucketBuiltin.set(a, ba || bb);
      const s = why.get(a) || new Set();
      for (const r of why.get(b) || []) s.add(r);
      s.add(reason);
      why.set(a, s);
    }
    const multiToken = (s) => norm(s).split(' ').filter(Boolean).length >= 2;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        const aReq = new Set(a.req.map(norm));
        if (b.req.some((r) => aReq.has(norm(r)))) tryUnion(i, j, 'same request wording');
        else if (norm(a.label) === norm(b.label)) tryUnion(i, j, 'same label');
        else {
          const aTerms = new Set([...a.rep, ...a.analytes].filter(multiToken).map(norm));
          if ([...b.rep, ...b.analytes].filter(multiToken).some((t) => aTerms.has(norm(t))))
            tryUnion(i, j, 'shared result/heading name');
        }
      }
    }
    const buckets = new Map();
    entries.forEach((e, i) => {
      const r = find(i);
      if (!buckets.has(r)) buckets.set(r, []);
      buckets.get(r).push(e);
    });

    // ── 3. build ───────────────────────────────────────────────────────────────────────────────────
    const overlay = OV.emptyOverlay();
    const takenInv = new Set(baseInv.keys());
    const takenRes = new Set(baseResults.keys());
    const newResultByName = new Map(); // norm text -> result id (practice results, shared across entries)
    const overlayResults = new Map(); // id -> overlay result (built-in extensions AND new)
    const overlayInvs = new Map();

    const uniqueId = (wanted, taken, fallback) => {
      let s = slug(wanted) || fallback;
      if (!/^[a-z0-9]/.test(s)) s = fallback;
      let id = s;
      let n = 2;
      while (taken.has(id)) id = `${s.slice(0, 44)}-${n++}`;
      taken.add(id);
      return id;
    };
    let aliasAdds = 0;
    const resultEntryFor = (id) => {
      if (overlayResults.has(id)) return overlayResults.get(id);
      const b = baseResults.get(id);
      const r = b
        ? { id, label: b.label, valueKind: b.valueKind, codes: [], aliases: [], provenance: provenance() }
        : null;
      if (r) overlayResults.set(id, r);
      return r;
    };
    const addAlias = (resultId, text) => {
      const r = resultEntryFor(resultId);
      if (!r) return;
      const known = (x) => norm(x.text) === norm(text) && (x.lab || '') === (labId || '');
      const baseR = baseResults.get(resultId);
      if (baseR && asArr(baseR.aliases).some(known)) return;
      if (!r.aliases.some(known)) {
        r.aliases.push({ text, ...(labId ? { lab: labId } : {}) });
        aliasAdds++;
      }
    };
    const resolveResult = (text, hint) => {
      const n = norm(text);
      if (baseResultByName.has(n)) return { id: baseResultByName.get(n), existing: true };
      if (newResultByName.has(n)) return { id: newResultByName.get(n), existing: false };
      const id = uniqueId('practice-' + text, takenRes, 'practice-result');
      const kind = hint === 'imaging' ? 'text' : 'mixed';
      overlayResults.set(id, {
        id,
        label: text,
        valueKind: kind,
        codes: [],
        aliases: [{ text, ...(labId ? { lab: labId } : {}) }],
        provenance: provenance(),
      });
      newResultByName.set(n, id);
      return { id, existing: false };
    };

    const microLabels = [];
    let seq = 0;
    for (const group of buckets.values()) {
      seq++;
      const builtinId = group.map((e) => e.builtinId).find(Boolean) || null;
      const b = builtinId ? baseInv.get(builtinId) : null;
      const label = b ? b.label : group[0].label;
      const req = [];
      const rep = [];
      const analytes = [];
      const seenReq = new Set();
      const seenRep = new Set();
      const seenAn = new Set();
      let single = false;
      for (const e of group) {
        for (const r of e.req) if (!seenReq.has(norm(r))) seenReq.add(norm(r)), req.push(r);
        for (const r of e.rep) if (!seenRep.has(norm(r))) seenRep.add(norm(r)), rep.push(r);
        for (const a of e.analytes) if (!seenAn.has(norm(a))) seenAn.add(norm(a)), analytes.push(a);
        if (e.single) single = true;
      }
      const kindGuess = b ? b.kind : guessKind(label, req);
      if (group.length > 1)
        note(
          'merged',
          `${group.length} entries merged into "${label}": ${group.map((e) => `${e.label} [${e.key}]`).join('; ')} — ${[
            ...(why.get(find(entries.indexOf(group[0]))) || []),
          ].join(', ')}.`,
          { keys: group.map((e) => e.key) }
        );

      const inv = {
        id: b ? b.id : uniqueId('practice-' + label, takenInv, `practice-investigation-${seq}`),
        label,
        kind: kindGuess,
        requestAliases: [],
        headingAliases: [],
        exclude: [],
        members: [],
        provenance: provenance(),
      };
      if (b && b.legacyKey) inv.legacyKey = b.legacyKey;
      const haveReq = new Set([
        ...asArr(b && b.requestAliases).map((a) => norm(a.text)),
        ...asArr(b && b.synonyms).map(norm),
      ]);
      const haveHead = new Set(asArr(b && b.headingAliases).map(norm));
      for (const r of req) if (!haveReq.has(norm(r))) inv.requestAliases.push({ text: r, system: 'any' });
      for (const r of rep) if (!haveHead.has(norm(r))) inv.headingAliases.push(r);

      // members
      const baseMembers = new Map(asArr(b && b.members).map((m) => [m.result, m]));
      const baseSingle = b ? asArr(b.members).filter((m) => m.role === 'core').length === 1 : false;
      const memberIds = new Set(baseMembers.keys());
      const flaggedOptional = [];
      const aliasAddsBefore = aliasAdds;
      for (const a of analytes) {
        const hitId = baseResultByName.get(norm(a));
        if (b) {
          if (hitId && memberIds.has(hitId)) {
            addAlias(hitId, a); // the lab's own wording of a result the built-in already counts
            continue;
          }
          if (!hitId && baseSingle) {
            // a second core result would raise the built-in's threshold from 1 to 2: treat it as another name instead
            addAlias(asArr(b.members).find((m) => m.role === 'core').result, a);
            continue;
          }
          const r = resolveResult(a, kindGuess);
          if (!memberIds.has(r.id)) {
            memberIds.add(r.id);
            inv.members.push({ result: r.id, role: 'optional' });
            flaggedOptional.push(a);
          }
          continue;
        }
        const r = resolveResult(a, kindGuess);
        if (r.existing) addAlias(r.id, a); // the lab's own wording of a known result (lab-tagged when a lab is chosen)
        if (memberIds.has(r.id)) continue;
        memberIds.add(r.id);
        inv.members.push(single ? { result: r.id, role: 'core', anchor: true } : { result: r.id, role: 'core' });
      }
      if (flaggedOptional.length)
        note(
          'review',
          `"${label}" (built-in, several core results): ${flaggedOptional.length} result name(s) added as OPTIONAL members — ${flaggedOptional.join(', ')}. Promote to core only if the report should count them.`,
          { id: inv.id }
        );
      if (!b && !inv.members.length) {
        if (LC.KINDS_NEEDING_RESULTS.includes(inv.kind)) inv.kind = 'other';
        note(
          'review',
          `"${label}" has no result names, so it can be recognised from the request and report heading only; kind set to "${inv.kind}".`,
          { id: inv.id }
        );
      }
      if (!b && inv.kind === 'microbiology') microLabels.push(label);
      if (b)
        note(
          'extends',
          `"${label}" extends the built-in test "${b.id}" (${inv.requestAliases.length} new request wording(s), ${inv.headingAliases.length} new heading(s), ${inv.members.length} new member(s)).`,
          { id: inv.id }
        );

      // does a NEW investigation's request wording also resolve to a built-in? (informational; never auto-merged)
      if (!b) {
        try {
          const idx = LC.buildIndex(base);
          for (const r of req) {
            const hits = LC.resolveRequest(idx, r).filter((h) => baseInv.has(h.investigationId));
            if (hits.length)
              note(
                'overlap',
                `Request "${r}" (${label}) also matches the built-in "${baseInv.get(hits[0].investigationId).label}". Kept separate — check they are genuinely different tests.`,
                { id: inv.id }
              );
          }
        } catch (_) {
          /* the built-in index failing is reported elsewhere; the overlap hint is optional */
        }
      }

      // an alias added to one of the built-in's results still needs an entry to carry the approval
      const changed =
        !b ||
        inv.requestAliases.length ||
        inv.headingAliases.length ||
        inv.members.length ||
        aliasAdds > aliasAddsBefore;
      if (changed) overlay.investigations.push(inv);
      else note('unchanged', `"${label}" adds nothing to the built-in test; skipped.`, { id: inv.id });
    }
    if (microLabels.length)
      note(
        'review',
        `Microbiology tests (${microLabels.join(', ')}): result names such as "Culture" are shared by several swab types, so these are recognised from the request and report heading until real reports are captured.`
      );
    overlay.results = [...overlayResults.values()].filter((r) => !baseResults.has(r.id) || r.aliases.length);
    overlay.disabled.investigations = [...new Set(disabledInv)];
    disabledInv.forEach((id) =>
      note('disabled', `Built-in test "${id}" was disabled in the old settings; imported as disabled.`, { id })
    );

    const validated = OV.sanitiseOverlay(overlay);
    return {
      overlay: validated,
      review,
      counts: {
        entries: entries.length,
        investigations: validated.investigations.length,
        results: validated.results.length,
      },
    };
  }

  // Add an imported overlay onto an EXISTING overlay without ever replacing local work: entries whose id is already
  // present locally are left alone; the rest are appended (still unreviewed). The imported side is FORCED INERT here,
  // not just trusted to arrive inert: importOirTests already emits reviewed:false, but any future caller passing a
  // crafted or foreign overlay must not be able to smuggle a pre-approved entry past the per-machine review gate.
  function mergeIntoOverlay(existing, imported) {
    const OV = overlayApi();
    const local = OV.sanitiseOverlay(existing);
    const inert = OV.forceInert(imported);
    const next = JSON.parse(JSON.stringify(local));
    let added = 0;
    let skipped = 0;
    // tests the person deleted are not brought back by reading their Outstanding Requests tests again
    const dismissed = new Set(next.context && Array.isArray(next.context.dismissed) ? next.context.dismissed : []);
    let dismissedSkipped = 0;
    const isNew = (kind, e) => !next[kind].some((x) => x.id === e.id);
    const dropInv = new Set(
      (imported.investigations || []).filter((e) => dismissed.has(e.id) && isNew('investigations', e)).map((e) => e.id)
    );
    // results only the dropped tests use are dropped with them (nothing else would reference them)
    const usedByKept = new Set();
    for (const e of [...next.investigations, ...(imported.investigations || []).filter((x) => !dropInv.has(x.id))])
      for (const m of e.members || []) usedByKept.add(m.result);
    for (const kind of ['results', 'investigations', 'labs']) {
      const have = new Set(next[kind].map((e) => e.id));
      for (const e of inert[kind] || []) {
        if (have.has(e.id)) {
          skipped++;
          continue;
        }
        if (kind === 'investigations' && dropInv.has(e.id)) {
          dismissedSkipped++;
          continue;
        }
        if (kind === 'results' && dropInv.size && !usedByKept.has(e.id)) continue;
        next[kind].push(e);
        have.add(e.id);
        added++;
      }
    }
    for (const id of inert.disabled ? inert.disabled.investigations : []) {
      if (!next.disabled.investigations.includes(id)) next.disabled.investigations.push(id);
    }
    return { overlay: OV.sanitiseOverlay(next), added, skipped, dismissedSkipped };
  }

  const api = { importOirTests, mergeIntoOverlay, repairFragments, guessKind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LabCatalogueImport = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : global);
