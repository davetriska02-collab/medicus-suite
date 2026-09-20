// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Result Catalogue core (pure logic: no DOM, no chrome.*, no fetch, no storage).
//
// PHASE A of docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md. NOTHING ELSE READS THIS YET — it is built
// alongside (not into) Lab Filing and the Outstanding Investigations matcher; migrating either onto it is a later,
// separately-reviewed phase. It is deliberately not loaded by manifest.json, options.html or any content script.
//
// What it does
//   validateCatalogue(cat)              -> { errors[], warnings[] }   (schema + referential + safety checks)
//   buildIndex(cat, opts)               -> index                      (throws on an invalid catalogue)
//   fromInvestigationReportPayload(p)   -> resolver report            (adapter over the raw Medicus API shape)
//   resolveReport(index, report)        -> resolution                 (per result / per group / coverage)
//   resolveRequest(index, label, opts)  -> [{ investigationId, alias }]  (outstanding-request card line -> test)
//   parseRequestName(label)             -> name without the "(Dr X • date)" suffix
//
// Model in one paragraph: a RESULT is identified by SNOMED code(s) first and lab-tagged text aliases second; an
// INVESTIGATION lists RESULT members (core | shared | optional) and the request/heading text that means it; a LAB
// (identified from report.performer) maps its own group headings to the investigations they IDENTIFY and to the
// investigations/results they MAY CONTAIN. Group <-> request is many-to-many: a heading yields a SET of candidates and
// results are attributed to investigations by MEMBERSHIP, never by heading alone.
//
// Safety posture (why this file is conservative)
//   * Code beats text. Text aliases match on WHOLE TOKENS only (never substrings), so "alp" can never match
//     "calprotectin", "alt" never "salt", "albumin" never "microalbumin".
//   * A text alias is only sufficient inside a heading's candidate scope; an unscoped alias hit is reported as
//     'alias-unscoped' and is NEVER enough to auto-file anything.
//   * A non-numeric result whose definition is numeric is a LAB MESSAGE (no value): it blocks filing, and is flagged so
//     a consumer can warn that some messages ("sample dropped", "wrong bottle") mean the test needs repeating. Whether
//     such a message clears an outstanding request is the consumer's decision (decided: it still clears — Nick,
//     2026-09-19 — but coverage carries labMessageOnly so it can be flagged).
//   * Completion is NOT required for a request to clear (a partial group clears its request; shared results are
//     optional) — that is today's behaviour and is intentional. Coverage therefore mirrors the existing matcher's
//     confident/tentative tiers; the improvement is in RECOGNITION, not in what clears.
//
// Dual-mode export: browser classic script -> window.LabCatalogue; Node/test -> require().

'use strict';

(function (global) {
  const SCHEMA_VERSION = 1;
  const ROLES = ['core', 'shared', 'optional'];
  const VALUE_KINDS = ['numeric', 'text', 'coded', 'mixed'];
  // The SAMPLE / kind of test. Specimen-based kinds must have at least one result to be recognised from.
  const KINDS = ['blood', 'urine', 'faeces', 'microbiology', 'imaging', 'procedure', 'other'];
  const KINDS_NEEDING_RESULTS = ['blood', 'urine', 'faeces', 'microbiology'];
  const SYSTEMS = ['tquest', 'ice', 'medicus', 'any'];
  const CODE_ROLES = ['primary', 'alternate'];
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const CONCEPT_RE = /^\d{6,18}$/;
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isStr = (v) => typeof v === 'string';
  const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;
  const asArr = (v) => (Array.isArray(v) ? v : []);

  // ── Text normalisation & whole-token matching ──────────────────────────────────
  // Same normalisation the Outstanding matcher uses: lowercase; keep + and & (u&e, "creatinine + electrolyte");
  // everything else becomes one space.
  function norm(s) {
    if (s == null) return '';
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9+&]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Does normalised `text` contain normalised `term` as a WHOLE token run? A trailing plural "s" on the text token is
  // tolerated (term "triglyceride" matches token "triglycerides"; term "u&e" matches "u&es"; "lft" matches "lfts").
  function hasTerm(text, term) {
    if (!text || !term) return false;
    const hay = ' ' + text + ' ';
    return hay.indexOf(' ' + term + ' ') !== -1 || hay.indexOf(' ' + term + 's ') !== -1;
  }

  const tokenCount = (normText) => (normText ? normText.split(' ').length : 0);

  // ── Validation ─────────────────────────────────────────────────────────────────
  function validateCatalogue(cat) {
    const errors = [];
    const warnings = [];
    const err = (m) => errors.push(m);
    const warn = (m) => warnings.push(m);
    if (!isObj(cat)) return { errors: ['catalogue must be an object'], warnings };
    if (cat.schema !== SCHEMA_VERSION) err(`schema must be ${SCHEMA_VERSION} (got ${JSON.stringify(cat.schema)})`);
    for (const k of Object.keys(cat)) if (DANGEROUS_KEYS.has(k)) err(`forbidden key "${k}"`);

    const results = asArr(cat.results);
    const investigations = asArr(cat.investigations);
    const labs = asArr(cat.labs);
    if (!Array.isArray(cat.results)) err('results must be an array');
    if (!Array.isArray(cat.investigations)) err('investigations must be an array');
    if (cat.labs !== undefined && !Array.isArray(cat.labs)) err('labs must be an array');
    const retired = new Set(asArr(cat.retired).filter(isStr));

    const resultIds = new Set();
    const invIds = new Set();
    const codeOwner = new Map();

    // results
    results.forEach((r, i) => {
      const where = `results[${i}]${r && r.id ? ` (${r.id})` : ''}`;
      if (!isObj(r)) return err(`${where}: must be an object`);
      if (!isStr(r.id) || !SLUG_RE.test(r.id)) err(`${where}: id must match ${SLUG_RE}`);
      else if (resultIds.has(r.id)) err(`${where}: duplicate result id`);
      else resultIds.add(r.id);
      if (isStr(r.id) && retired.has(r.id)) err(`${where}: id was retired and must not be reused`);
      if (!isNonEmptyStr(r.label)) err(`${where}: label is required`);
      if (!VALUE_KINDS.includes(r.valueKind)) err(`${where}: valueKind must be one of ${VALUE_KINDS.join(', ')}`);
      const codes = asArr(r.codes);
      if (r.codes !== undefined && !Array.isArray(r.codes)) err(`${where}: codes must be an array`);
      let primaries = 0;
      codes.forEach((c, j) => {
        const cw = `${where}.codes[${j}]`;
        if (!isObj(c)) return err(`${cw}: must be an object`);
        if (!isStr(c.conceptId) || !CONCEPT_RE.test(c.conceptId)) err(`${cw}: conceptId must be digits (6-18)`);
        if (!CODE_ROLES.includes(c.role)) err(`${cw}: role must be primary or alternate`);
        if (c.role === 'primary') primaries++;
        if (c.unit !== undefined && !isStr(c.unit)) err(`${cw}: unit must be a string`);
        if (c.refsets !== undefined && !(Array.isArray(c.refsets) && c.refsets.every(isNonEmptyStr))) {
          err(`${cw}: refsets must be an array of cluster ids`);
        }
        if (isStr(c.conceptId)) {
          if (codeOwner.has(c.conceptId) && codeOwner.get(c.conceptId) !== r.id) {
            err(`${cw}: concept ${c.conceptId} is already claimed by result "${codeOwner.get(c.conceptId)}"`);
          } else if (codeOwner.get(c.conceptId) === r.id) {
            err(`${cw}: concept ${c.conceptId} listed twice on this result`);
          } else codeOwner.set(c.conceptId, r.id);
        }
      });
      if (primaries > 1) err(`${where}: at most one primary code`);
      const aliases = asArr(r.aliases);
      if (r.aliases !== undefined && !Array.isArray(r.aliases)) err(`${where}: aliases must be an array`);
      aliases.forEach((a, j) => {
        const aw = `${where}.aliases[${j}]`;
        if (!isObj(a) || !isNonEmptyStr(a.text)) return err(`${aw}: needs a non-empty text`);
        if (a.lab !== undefined && !isNonEmptyStr(a.lab)) err(`${aw}: lab must be a non-empty string when present`);
        const n = norm(a.text);
        if (!n) err(`${aw}: alias normalises to nothing`);
        else if (!a.lab && n.replace(/ /g, '').length <= 3) {
          warn(`${aw}: short lab-neutral alias "${a.text}" — whole-token matching only, but prefer lab-tagging it`);
        }
      });
      if (
        r.excludeAliases !== undefined &&
        !(Array.isArray(r.excludeAliases) && r.excludeAliases.every(isNonEmptyStr))
      ) {
        err(`${where}: excludeAliases must be an array of strings`);
      }
      if (codes.length === 0 && aliases.length === 0) err(`${where}: needs at least one code or alias`);
    });

    // investigations
    const anyRequestAliases = [];
    investigations.forEach((v, i) => {
      const where = `investigations[${i}]${v && v.id ? ` (${v.id})` : ''}`;
      if (!isObj(v)) return err(`${where}: must be an object`);
      if (!isStr(v.id) || !SLUG_RE.test(v.id)) err(`${where}: id must match ${SLUG_RE}`);
      else if (invIds.has(v.id)) err(`${where}: duplicate investigation id`);
      else invIds.add(v.id);
      if (isStr(v.id) && retired.has(v.id)) err(`${where}: id was retired and must not be reused`);
      if (!isNonEmptyStr(v.label)) err(`${where}: label is required`);
      if (!KINDS.includes(v.kind)) err(`${where}: kind must be one of ${KINDS.join(', ')}`);
      const reqs = asArr(v.requestAliases);
      if (v.requestAliases !== undefined && !Array.isArray(v.requestAliases))
        err(`${where}: requestAliases must be an array`);
      reqs.forEach((a, j) => {
        const aw = `${where}.requestAliases[${j}]`;
        if (!isObj(a) || !isNonEmptyStr(a.text)) return err(`${aw}: needs a non-empty text`);
        if (!SYSTEMS.includes(a.system)) err(`${aw}: system must be one of ${SYSTEMS.join(', ')}`);
        if (!norm(a.text)) err(`${aw}: alias normalises to nothing`);
        anyRequestAliases.push(v.id);
      });
      if (
        v.headingAliases !== undefined &&
        !(Array.isArray(v.headingAliases) && v.headingAliases.every(isNonEmptyStr))
      ) {
        err(`${where}: headingAliases must be an array of strings`);
      }
      if (v.exclude !== undefined && !(Array.isArray(v.exclude) && v.exclude.every(isNonEmptyStr))) {
        err(`${where}: exclude must be an array of strings`);
      }
      const members = asArr(v.members);
      if (v.members !== undefined && !Array.isArray(v.members)) err(`${where}: members must be an array`);
      const seen = new Set();
      members.forEach((m, j) => {
        const mw = `${where}.members[${j}]`;
        if (!isObj(m) || !isStr(m.result)) return err(`${mw}: needs a result id`);
        if (!resultIds.has(m.result)) err(`${mw}: unknown result "${m.result}"`);
        if (seen.has(m.result)) err(`${mw}: duplicate member "${m.result}"`);
        seen.add(m.result);
        if (!ROLES.includes(m.role)) err(`${mw}: role must be one of ${ROLES.join(', ')}`);
        if (m.anchor !== undefined && typeof m.anchor !== 'boolean') err(`${mw}: anchor must be a boolean`);
        if (m.anchor === true && m.role !== 'core') err(`${mw}: only a core member can be an anchor`);
      });
      if (KINDS_NEEDING_RESULTS.includes(v.kind) && members.length === 0) {
        err(`${where}: a ${v.kind} investigation needs at least one member`);
      }
      if (members.length > 0 && !members.some((m) => m && m.role === 'core')) {
        err(`${where}: needs at least one core member (it is what identifies the test)`);
      }
      if (v.note !== undefined && !isStr(v.note)) err(`${where}: note must be a string`);
    });
    investigations.forEach((v) => {
      if (isObj(v) && asArr(v.requestAliases).length === 0) warn(`investigation "${v.id}" has no requestAliases`);
    });

    // labs
    const labIds = new Set();
    labs.forEach((l, i) => {
      const where = `labs[${i}]${l && l.id ? ` (${l.id})` : ''}`;
      if (!isObj(l)) return err(`${where}: must be an object`);
      if (!isStr(l.id) || !SLUG_RE.test(l.id)) err(`${where}: id must match ${SLUG_RE}`);
      else if (labIds.has(l.id)) err(`${where}: duplicate lab id`);
      else labIds.add(l.id);
      if (!isNonEmptyStr(l.name)) err(`${where}: name is required`);
      if (!isObj(l.identifiers) || !isNonEmptyStr(l.identifiers.performerOrg)) {
        err(`${where}: identifiers.performerOrg is required`);
      }
      if (l.orderingSystem !== undefined && !SYSTEMS.includes(l.orderingSystem)) {
        err(`${where}: orderingSystem must be one of ${SYSTEMS.join(', ')}`);
      }
      asArr(l.groupHeadings).forEach((h, j) => {
        const hw = `${where}.groupHeadings[${j}]`;
        if (!isObj(h) || !isNonEmptyStr(h.text)) return err(`${hw}: needs a non-empty text`);
        if (!norm(h.text)) err(`${hw}: heading normalises to nothing`);
        asArr(h.identifies).forEach((id) => {
          if (!invIds.has(id)) err(`${hw}: identifies unknown investigation "${id}"`);
        });
        asArr(h.mayContain).forEach((ref) => {
          if (!isStr(ref) || !/^(inv|res):/.test(ref))
            return err(`${hw}: mayContain entries must be "inv:<id>" or "res:<id>"`);
          const id = ref.slice(4);
          if (ref.startsWith('inv:') && !invIds.has(id)) err(`${hw}: mayContain unknown investigation "${id}"`);
          if (ref.startsWith('res:') && !resultIds.has(id)) err(`${hw}: mayContain unknown result "${id}"`);
        });
        if (asArr(h.identifies).length === 0 && asArr(h.mayContain).length === 0) {
          warn(`${hw}: heading "${h.text}" identifies and may-contain nothing`);
        }
      });
    });
    return { errors, warnings };
  }

  // ── Index ──────────────────────────────────────────────────────────────────────
  function buildIndex(cat, opts) {
    const v = validateCatalogue(cat);
    if (v.errors.length && !(opts && opts.allowInvalid)) {
      throw new Error('Invalid lab catalogue: ' + v.errors.slice(0, 5).join('; ') + (v.errors.length > 5 ? ' …' : ''));
    }
    const results = new Map();
    const byCode = new Map();
    const resultAliases = new Map(); // resultId -> [{ norm, len, lab }]
    const resultExcludes = new Map(); // resultId -> [norm]
    for (const r of asArr(cat.results)) {
      if (!isObj(r) || !isStr(r.id)) continue;
      results.set(r.id, r);
      for (const c of asArr(r.codes))
        if (isObj(c) && isStr(c.conceptId)) byCode.set(c.conceptId, { resultId: r.id, code: c });
      const list = [];
      const push = (text, lab) => {
        const n = norm(text);
        if (n) list.push({ norm: n, len: tokenCount(n), lab: lab || null });
      };
      push(r.label, null);
      for (const a of asArr(r.aliases)) if (isObj(a)) push(a.text, a.lab);
      resultAliases.set(r.id, list);
      resultExcludes.set(r.id, asArr(r.excludeAliases).map(norm).filter(Boolean));
    }

    const investigations = new Map();
    const membership = new Map(); // resultId -> [{ investigationId, role, anchor }]
    const requestTable = [];
    const headingTable = [];
    for (const inv of asArr(cat.investigations)) {
      if (!isObj(inv) || !isStr(inv.id)) continue;
      const members = asArr(inv.members).filter(isObj);
      const coreIds = new Set(members.filter((m) => m.role === 'core').map((m) => m.result));
      const anchorIds = new Set(members.filter((m) => m.role === 'core' && m.anchor === true).map((m) => m.result));
      const exclude = asArr(inv.exclude).map(norm).filter(Boolean);
      investigations.set(inv.id, {
        def: inv,
        coreIds,
        anchorIds,
        singleResult: coreIds.size === 1,
        memberIds: new Set(members.map((m) => m.result)),
        exclude,
      });
      for (const m of members) {
        if (!membership.has(m.result)) membership.set(m.result, []);
        membership.get(m.result).push({ investigationId: inv.id, role: m.role, anchor: m.anchor === true });
      }
      const addReq = (text, system) => {
        const n = norm(text);
        if (n) requestTable.push({ investigationId: inv.id, norm: n, len: tokenCount(n), system, exclude });
      };
      addReq(inv.label, 'any');
      for (const a of asArr(inv.requestAliases)) if (isObj(a)) addReq(a.text, a.system);
      const addHead = (text) => {
        const n = norm(text);
        if (n) headingTable.push({ investigationId: inv.id, norm: n, len: tokenCount(n), exclude });
      };
      addHead(inv.label);
      for (const h of asArr(inv.headingAliases)) addHead(h);
    }

    const labs = [];
    for (const l of asArr(cat.labs)) {
      if (!isObj(l) || !isStr(l.id)) continue;
      labs.push({
        def: l,
        org: norm(l.identifiers.performerOrg),
        dept: isNonEmptyStr(l.identifiers.department) ? norm(l.identifiers.department) : null,
        headings: asArr(l.groupHeadings)
          .filter(isObj)
          .map((h) => ({
            norm: norm(h.text),
            identifies: asArr(h.identifies),
            mayContainInv: asArr(h.mayContain)
              .filter((x) => isStr(x) && x.startsWith('inv:'))
              .map((x) => x.slice(4)),
            mayContainRes: asArr(h.mayContain)
              .filter((x) => isStr(x) && x.startsWith('res:'))
              .map((x) => x.slice(4)),
          }))
          .filter((h) => h.norm),
      });
    }
    return {
      cat,
      results,
      byCode,
      resultAliases,
      resultExcludes,
      investigations,
      membership,
      requestTable,
      headingTable,
      labs,
    };
  }

  // ── Adapter over the raw Medicus API shape ────────────────────────────────────
  // Accepts { data: { investigationReport } } (the task overview response), { investigationReport }, or the report
  // itself. Keeps ONLY what resolution needs — never values, dates or patient fields.
  function fromInvestigationReportPayload(payload) {
    const rep =
      (payload && payload.data && payload.data.investigationReport) ||
      (payload && payload.investigationReport) ||
      payload ||
      {};
    const perf = isObj(rep.performer) ? rep.performer : {};
    const adaptResult = (r) => {
      const rc = isObj(r && r.resultCode) ? r.resultCode : {};
      const value = r ? r.resultValue : null;
      return {
        name: isStr(r && r.description) ? r.description : '',
        code: isStr(rc.conceptId) ? rc.conceptId : rc.conceptId != null ? String(rc.conceptId) : null,
        codeText: isStr(rc.description) ? rc.description : null,
        unit: isStr(r && r.resultUnit) ? r.resultUnit : null,
        resultType: isStr(r && r.resultType) ? r.resultType : null,
        hasNumericValue: !!r && r.resultType === 'unit-value-result' && value != null && String(value).trim() !== '',
        text: isStr(r && r.resultText) ? r.resultText : null,
        degraded: !!(r && r.hasUnresolvedDegradedTypeCode),
      };
    };
    return {
      lab: {
        organisation: isStr(perf.organisationName) ? perf.organisationName : null,
        department: isStr(perf.departmentName) ? perf.departmentName : null,
      },
      groups: asArr(rep.investigationGroups).map((g) => ({
        heading: isStr(g && g.description) ? g.description : '',
        specimenType: isObj(g && g.specimen) && isStr(g.specimen.type) ? g.specimen.type : null,
        results: asArr(g && g.results).map(adaptResult),
      })),
      ungrouped: asArr(rep.ungroupedResults).map(adaptResult),
    };
  }

  // ── Lab identification ────────────────────────────────────────────────────────
  function identifyLab(index, performer) {
    if (!performer || !performer.organisation) return null;
    const org = norm(performer.organisation);
    const dept = performer.department ? norm(performer.department) : null;
    for (const lab of index.labs) {
      if (lab.org !== org) continue;
      if (lab.dept && dept && lab.dept !== dept) continue;
      return lab;
    }
    return null;
  }

  // ── Lab message classification (advisory only) ────────────────────────────────
  // A non-numeric "result" for a numeric test is the lab talking, not a value. Some messages mean the test must be
  // REPEATED (sample dropped / wrong bottle) — flag them so a consumer can warn even though the request still clears.
  function classifyLabMessage(text) {
    const t = String(text || '');
    if (
      /(dropped|broken|leak|spill|insufficient|wrong (bottle|tube|sample|container)|haemoly|hemoly|unlabel|mislabel|not received|clotted|contaminat|reject|unsuitable|too old|degraded)/i.test(
        t
      )
    ) {
      return 'sample-problem'; // likely needs repeating
    }
    if (/(already (been )?performed|recently|previous(ly)? (result|performed)|within \d+ days)/i.test(t))
      return 'already-done';
    if (/not applicable|n\/a|cannot be calculated|not calculated/i.test(t)) return 'not-applicable';
    return 'other';
  }

  function valueStatus(def, r) {
    if (r.hasNumericValue) return { hasValue: true, labMessage: false, labMessageKind: null };
    const isText = r.resultType === 'text-result' || !!r.text;
    if (isText) {
      const kind = def ? def.valueKind : null;
      if (kind === 'text' || kind === 'coded' || kind === 'mixed')
        return { hasValue: true, labMessage: false, labMessageKind: null };
      return { hasValue: false, labMessage: true, labMessageKind: classifyLabMessage(r.text) };
    }
    return { hasValue: false, labMessage: false, labMessageKind: null };
  }

  // ── Heading resolution ─────────────────────────────────────────────────────────
  // A heading yields a SET of candidates: `identifies` (the investigation(s) the heading names — a group under this
  // heading answers them by heading alone) and `mayContain` (investigations/results the group is allowed to carry).
  function matchHeading(index, lab, headingText) {
    const h = norm(headingText);
    const identifies = new Set();
    const mayInv = new Set();
    const mayRes = new Set();
    let via = null;
    if (!h) return { identifies, candidates: new Set(), scopeResults: new Set(), matched: false, via };
    if (lab) {
      for (const e of lab.headings) {
        if (!hasTerm(h, e.norm)) continue;
        via = 'lab';
        e.identifies.forEach((id) => identifies.add(id));
        e.mayContainInv.forEach((id) => mayInv.add(id));
        e.mayContainRes.forEach((id) => mayRes.add(id));
      }
    }
    if (!identifies.size) {
      // lab-neutral heading aliases, most specific (longest) wins per investigation; an investigation's exclude terms apply
      for (const e of index.headingTable) {
        if (!hasTerm(h, e.norm)) continue;
        if (e.exclude.some((x) => hasTerm(h, x))) continue;
        identifies.add(e.investigationId);
        via = via || 'generic';
      }
    }
    const candidates = new Set([...identifies, ...mayInv]);
    const scopeResults = new Set(mayRes);
    for (const id of candidates) {
      const inv = index.investigations.get(id);
      if (inv) inv.memberIds.forEach((rid) => scopeResults.add(rid));
    }
    return { identifies, candidates, scopeResults, matched: candidates.size > 0, via };
  }

  // ── Result resolution ─────────────────────────────────────────────────────────
  function bestAlias(index, lab, normName, resultIds) {
    let best = null; // { resultId, len, alias }
    const ties = new Set();
    for (const rid of resultIds) {
      const list = index.resultAliases.get(rid);
      if (!list) continue;
      const excl = index.resultExcludes.get(rid) || [];
      if (excl.some((x) => hasTerm(normName, x))) continue;
      for (const a of list) {
        if (a.lab && !(lab && a.lab === lab.def.id)) continue;
        if (!hasTerm(normName, a.norm)) continue;
        if (!best || a.len > best.len) {
          best = { resultId: rid, len: a.len, alias: a.norm };
          ties.clear();
        } else if (a.len === best.len && rid !== best.resultId) ties.add(rid);
      }
    }
    if (best && ties.size) return { ambiguous: [best.resultId, ...ties] };
    return best;
  }

  function resolveResult(index, lab, r, scopeResults, scopeKnown) {
    const out = { resultId: null, confidence: 'unresolved', matchedAlias: null };
    if (r.code && index.byCode.has(r.code)) {
      out.resultId = index.byCode.get(r.code).resultId;
      out.confidence = 'coded';
      return out;
    }
    if (r.code) out.codeUnknown = r.code;
    const nm = norm(r.name);
    if (!nm) return out;
    if (scopeKnown && scopeResults.size) {
      const hit = bestAlias(index, lab, nm, scopeResults);
      if (hit && hit.ambiguous) {
        out.ambiguous = hit.ambiguous;
        return out;
      }
      if (hit) {
        out.resultId = hit.resultId;
        out.confidence = 'alias-in-scope';
        out.matchedAlias = hit.alias;
        return out;
      }
    }
    const any = bestAlias(index, lab, nm, index.results.keys());
    if (any && any.ambiguous) {
      out.ambiguous = any.ambiguous;
      return out;
    }
    if (any) {
      out.resultId = any.resultId;
      out.confidence = 'alias-unscoped'; // advisory only — never sufficient to file
      out.matchedAlias = any.alias;
    }
    return out;
  }

  // ── Report resolution ─────────────────────────────────────────────────────────
  function resolveReport(index, report) {
    const lab = identifyLab(index, report && report.lab);
    const groups = [];
    const flat = [];

    const prep = (grp, ungrouped) => {
      const hm = ungrouped
        ? { identifies: new Set(), candidates: new Set(), scopeResults: new Set(), matched: false, via: null }
        : matchHeading(index, lab, grp.heading);
      const resolved = asArr(grp.results).map((r) => {
        const rr = resolveResult(index, lab, r, hm.scopeResults, hm.matched);
        const def = rr.resultId ? index.results.get(rr.resultId) : null;
        const vs = valueStatus(def, r);
        return { input: r, ...rr, ...vs, attributedTo: [] };
      });
      return { heading: ungrouped ? null : grp.heading, hm, resolved, ungrouped: !!ungrouped };
    };

    const prepared = asArr(report && report.groups).map((g) => prep(g, false));
    const ungroupedPrepared = prep({ results: asArr(report && report.ungrouped) }, true);

    // Threshold for recognising an investigation from its core results: 1 for a single-result or anchored test, else 2.
    const thresholdFor = (inv, presentCore) =>
      inv.singleResult || [...inv.anchorIds].some((a) => presentCore.has(a)) ? 1 : 2;

    // Infer candidates for a group whose heading matched nothing, from the distinctive (core) results it holds.
    for (const p of prepared) {
      if (p.hm.matched) continue;
      const coreHere = new Set();
      p.resolved.forEach((r) => r.resultId && r.confidence !== 'unresolved' && coreHere.add(r.resultId));
      const inferred = new Set();
      for (const [id, inv] of index.investigations) {
        const present = new Set([...inv.coreIds].filter((c) => coreHere.has(c)));
        if (present.size && present.size >= thresholdFor(inv, present)) inferred.add(id);
      }
      p.inferred = inferred;
    }

    // Attribute results to investigations by MEMBERSHIP within the group's candidate set (never by heading alone).
    const attribute = (p) => {
      for (const r of p.resolved) {
        if (!r.resultId || r.confidence === 'unresolved') continue;
        const mem = index.membership.get(r.resultId) || [];
        if (p.ungrouped) {
          // No heading: attribute only to investigations where this result IS the whole test (sole core member).
          r.attributedTo = mem
            .filter((m) => m.role === 'core' && index.investigations.get(m.investigationId).singleResult)
            .map((m) => m.investigationId);
        } else if (p.hm.matched) {
          r.attributedTo = mem.filter((m) => p.hm.candidates.has(m.investigationId)).map((m) => m.investigationId);
        } else {
          r.attributedTo = mem
            .filter((m) => p.inferred && p.inferred.has(m.investigationId))
            .map((m) => m.investigationId);
        }
        r.outOfScope = !p.ungrouped && p.hm.matched && r.attributedTo.length === 0;
        // Evidence-only (never used for filing): with no usable heading a lone core result still counts toward the
        // existing matcher's TENTATIVE tier ("distinctive analyte matched — confirm before clearing").
        if (p.ungrouped || !p.hm.matched) {
          r.evidenceOnly = mem.filter((m) => m.role === 'core').map((m) => m.investigationId);
        }
      }
    };
    prepared.forEach(attribute);
    attribute(ungroupedPrepared);

    // Coverage — mirrors the existing matcher's confident/tentative tiers (see header).
    const coverage = new Map();
    const upgrade = (id, conf, via, rids, labMessageOnly) => {
      const cur = coverage.get(id);
      if (!cur || (conf === 'confident' && cur.confidence !== 'confident')) {
        coverage.set(id, { confidence: conf, via, results: [...new Set(rids)], labMessageOnly });
      } else if (conf === cur.confidence) {
        cur.results = [...new Set([...cur.results, ...rids])];
        cur.labMessageOnly = cur.labMessageOnly && labMessageOnly;
      }
    };
    for (const p of prepared) {
      for (const id of p.hm.identifies) {
        const rids = p.resolved.filter((r) => r.resultId).map((r) => r.resultId);
        const onlyMsgs = p.resolved.length > 0 && p.resolved.every((r) => r.labMessage);
        upgrade(id, 'confident', 'heading', rids, onlyMsgs);
      }
    }
    const allResolved = [...prepared.flatMap((p) => p.resolved), ...ungroupedPrepared.resolved];
    for (const [id, inv] of index.investigations) {
      const supporting = allResolved.filter(
        (r) =>
          (r.attributedTo.includes(id) || (r.evidenceOnly && r.evidenceOnly.includes(id))) &&
          inv.coreIds.has(r.resultId)
      );
      const presentCore = new Set(supporting.map((r) => r.resultId));
      if (!presentCore.size) continue;
      const need = thresholdFor(inv, presentCore);
      const conf = presentCore.size >= need ? 'confident' : 'tentative';
      upgrade(
        id,
        conf,
        'signature',
        [...presentCore],
        supporting.every((r) => r.labMessage)
      );
    }

    for (const p of prepared) {
      groups.push({
        heading: p.heading,
        headingConfidence: p.hm.matched ? 'heading' : p.inferred && p.inferred.size ? 'inferred' : null,
        identifies: [...p.hm.identifies],
        candidates: [...(p.hm.matched ? p.hm.candidates : p.inferred || [])],
        results: p.resolved.map(publicResult),
      });
    }
    groups.push({
      heading: null,
      headingConfidence: null,
      identifies: [],
      candidates: [],
      ungrouped: true,
      results: ungroupedPrepared.resolved.map(publicResult),
    });
    for (const g of groups) for (const r of g.results) flat.push(r);

    const coverageObj = {};
    for (const [id, c] of coverage) coverageObj[id] = c;
    return {
      lab: lab ? lab.def.id : null,
      groups,
      results: flat,
      coverage: coverageObj,
      unresolved: flat.filter((r) => r.confidence === 'unresolved'),
      resolvedResultIds: [...new Set(flat.filter((r) => r.resultId && r.hasValue).map((r) => r.resultId))],
    };
  }

  function publicResult(r) {
    return {
      name: r.input.name,
      code: r.input.code,
      resultId: r.resultId,
      confidence: r.confidence,
      hasValue: r.hasValue,
      labMessage: r.labMessage,
      labMessageKind: r.labMessageKind,
      attributedTo: r.attributedTo,
      outOfScope: !!r.outOfScope,
      ambiguous: r.ambiguous || null,
      codeUnknown: r.codeUnknown || null,
    };
  }

  // ── Request card lines ─────────────────────────────────────────────────────────
  // "Liver Function (Dr Jane Smith • 09 Sep 2026, 14:06)" -> "Liver Function". A request test name may itself end in a
  // bracket ("Bone Profile (Calcium Studies)"), so only the LAST bracket group containing a bullet is removed.
  function parseRequestName(label) {
    const raw = label == null ? '' : String(label).replace(/\s+/g, ' ').trim();
    const open = raw.lastIndexOf('(');
    if (open > 0 && raw.indexOf('•', open) !== -1) return raw.slice(0, open).trim();
    return raw;
  }

  // Request text -> investigations, most specific alias first. opts.system restricts to that ordering system (aliases
  // tagged 'any' or 'medicus' always apply). Returns [] when nothing is recognised — the caller leaves it outstanding.
  function resolveRequest(index, label, opts) {
    const name = norm(parseRequestName(label));
    if (!name) return [];
    const system = opts && opts.system ? opts.system : null;
    const best = new Map(); // investigationId -> { len, alias }
    for (const e of index.requestTable) {
      if (system && e.system !== system && e.system !== 'any' && e.system !== 'medicus') continue;
      if (!hasTerm(name, e.norm)) continue;
      if (e.exclude.some((x) => hasTerm(name, x))) continue;
      const cur = best.get(e.investigationId);
      if (!cur || e.len > cur.len) best.set(e.investigationId, { len: e.len, alias: e.norm });
    }
    return [...best.entries()]
      .sort((a, b) => b[1].len - a[1].len)
      .map(([investigationId, v]) => ({ investigationId, alias: v.alias, specificity: v.len }));
  }

  const api = {
    SCHEMA_VERSION,
    ROLES,
    VALUE_KINDS,
    KINDS,
    KINDS_NEEDING_RESULTS,
    SYSTEMS,
    norm,
    hasTerm,
    validateCatalogue,
    buildIndex,
    fromInvestigationReportPayload,
    identifyLab,
    classifyLabMessage,
    resolveReport,
    resolveRequest,
    parseRequestName,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.LabCatalogue = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
